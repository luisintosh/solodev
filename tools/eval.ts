#!/usr/bin/env node
/**
 * Outcome evals on test/fixture-repo (evals/outcome/):
 *   validate   each task's held-out tests fail on the seeded fixture and pass with its reference solution (no agents)
 *   run        run /solodev-mission for a config over the tasks, then score with the held-out tests; appends to results/
 *   report     mean and spread per config, and the release bar against the baseline
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  CLAUDE_ALLOWED,
  copyDir,
  install,
  moveUserSkillsAside,
  root,
  sh,
  stateIn,
  type Usage,
  usage,
  workspace,
} from "./eval-lib.ts"

const evalDir = path.join(root, "evals", "outcome")
const tasksDir = path.join(evalDir, "tasks")
const resultsDir = path.join(evalDir, "results")

type Tool = "claude" | "codex" | "cursor"
type Config = { id: string; install: string; home: Tool; writer: Tool; suffix?: string; note?: string }
type Task = { id: string; shape: string; prompt: string }

export type Result = Usage & {
  config: string
  task: string
  run: number
  date: string
  passed: number
  failed: number
  /** Every held-out test passed. */
  success: boolean
  wallSeconds: number
  agentExit: number | null
  gateRecorded: boolean
  diffLines: number
}

async function loadTasks(only?: string): Promise<Task[]> {
  const ids = (await fs.readdir(tasksDir)).sort().filter((id) => !only || id === only)
  if (only && !ids.length) throw new Error(`no task ${only}`)
  return Promise.all(
    ids.map(async (id) => ({ id, ...JSON.parse(await fs.readFile(path.join(tasksDir, id, "task.json"), "utf8")) })),
  )
}

/** A fresh git repo: the fixture plus the task's seed files, committed on main. */
function taskWorkspace(task: Task): Promise<string> {
  return workspace(task.id, [path.join(tasksDir, task.id, "seed")])
}

/** Copies the held-out tests in last, so the agent never saw them, and runs them. */
async function score(ws: string, task: Task): Promise<{ passed: number; failed: number; output: string }> {
  const dest = path.join(ws, ".heldout")
  await fs.rm(dest, { recursive: true, force: true })
  await copyDir(path.join(tasksDir, task.id, "heldout"), dest)
  const files = (await fs.readdir(dest)).map((f) => path.join(".heldout", f))
  const r = sh(process.execPath, ["--test", "--test-reporter=tap", ...files], ws, { timeoutMs: 120_000 })
  const output = `${r.stdout}\n${r.stderr}`
  const count = (key: string) => Number(output.match(new RegExp(`^# ${key} (\\d+)`, "m"))?.[1] ?? 0)
  // A file that can't even load still fails the run, even when TAP counted nothing.
  return { passed: count("pass"), failed: count("fail") || (r.code === 0 ? 0 : 1), output }
}

async function validate(only?: string): Promise<number> {
  let problems = 0
  for (const task of await loadTasks(only)) {
    const ws = await taskWorkspace(task)
    try {
      const before = await score(ws, task)
      await copyDir(path.join(tasksDir, task.id, "reference"), ws)
      const after = await score(ws, task)
      const okBefore = before.failed > 0
      const okAfter = after.failed === 0 && after.passed > 0
      if (!okBefore || !okAfter) problems++
      console.log(
        `${okBefore && okAfter ? "✓" : "✗"} ${task.id} (${task.shape}): fixture ${before.passed} pass / ${before.failed} fail · reference ${after.passed} pass / ${after.failed} fail`,
      )
      if (!okAfter) console.log(after.output.split("\n").slice(-30).join("\n"))
    } finally {
      await fs.rm(ws, { recursive: true, force: true })
    }
  }
  return problems ? 1 : 0
}

function prompt(task: Task, config: Config): string {
  return [
    `/solodev-mission ${task.prompt}`,
    "",
    `This is an unattended eval run. I approve the spec as soon as you present it, and the coder is ${config.writer}.`,
    "There is no git remote: skip pushing, the pull request and PR comments, and stop once the work is committed and",
    "the checks for marking the PR ready would pass.",
    config.suffix ?? "",
  ]
    .join("\n")
    .trim()
}

/**
 * The headless command for each coding tool. These run on the host, not in a container, so each one is limited as far
 * as its CLI allows: Claude Code to an allowlist, Codex to its workspace-write sandbox. Cursor's headless mode can only
 * approve everything (`--force`), so it runs only with --allow-unsandboxed.
 */
function agentCommand(home: Tool, text: string, allowUnsandboxed: boolean): [string, string[]] {
  if (home === "claude") {
    return ["claude", ["-p", text, "--output-format", "json", "--allowedTools", CLAUDE_ALLOWED.join(" ")]]
  }
  if (home === "codex") return ["codex", ["exec", "--json", "--sandbox", "workspace-write", text]]
  if (!allowUnsandboxed) {
    throw new Error(
      "Cursor's `agent` can't run headless without approving every command (--force); run it in a container or VM and pass --allow-unsandboxed",
    )
  }
  return ["agent", ["-p", text, "--output-format", "json", "--force"]]
}

/** An approval line in a feature's progress.md, or, for releases before v3.1, an approval commit's trailer. */
async function gateRecorded(ws: string, state: string): Promise<boolean> {
  if (sh("git", ["log", "--grep", "Solodev-Gate: approved", "--format=%H"], ws).stdout.trim() !== "") return true
  const files = await fs.readdir(state, { recursive: true }).catch(() => [] as string[])
  for (const f of files.filter((f) => path.basename(f) === "progress.md")) {
    if (/^- approved /m.test(await fs.readFile(path.join(state, f), "utf8"))) return true
  }
  return false
}

async function runConfig(
  configId: string,
  only: string | undefined,
  repeats: number,
  allowUnsandboxed: boolean,
): Promise<number> {
  const { configs } = JSON.parse(await fs.readFile(path.join(evalDir, "configs.json"), "utf8")) as { configs: Config[] }
  const config = configs.find((c) => c.id === configId)
  if (!config) throw new Error(`no config ${configId}; see evals/outcome/configs.json`)
  await fs.mkdir(resultsDir, { recursive: true })
  const out = path.join(resultsDir, `${config.id}.jsonl`)
  for (const task of await loadTasks(only)) {
    for (let i = 1; i <= repeats; i++) {
      const ws = await taskWorkspace(task)
      try {
        install(ws, config.install)
        const base = sh("git", ["rev-parse", "HEAD"], ws).stdout.trim()
        const state = await stateIn(ws)
        const [cmd, args] = agentCommand(config.home, prompt(task, config), allowUnsandboxed)
        const started = Date.now()
        const agent = sh(cmd, args, ws, {
          timeoutMs: 60 * 60_000,
          env: { SOLODEV_HOME: config.home, SOLODEV_STATE: state },
        })
        const wallSeconds = Math.round((Date.now() - started) / 1000)
        const scored = await score(ws, task)
        const stat = sh(
          "git",
          ["diff", "--shortstat", base, "--", ".", ":(exclude)docs", ":(exclude).heldout"],
          ws,
        ).stdout
        const result: Result = {
          config: config.id,
          task: task.id,
          run: i,
          date: new Date().toISOString(),
          passed: scored.passed,
          failed: scored.failed,
          success: scored.failed === 0 && scored.passed > 0,
          wallSeconds,
          agentExit: agent.code,
          ...usage(agent.stdout),
          gateRecorded: await gateRecorded(ws, state),
          diffLines: [...stat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((n, m) => n + Number(m[1]), 0),
        }
        await fs.appendFile(out, `${JSON.stringify(result)}\n`)
        console.log(
          `${result.success ? "✓" : "✗"} ${config.id} ${task.id} #${i}: ${result.passed}/${result.passed + result.failed} held-out · ${wallSeconds}s · $${result.costUsd ?? "?"}`,
        )
      } finally {
        await fs.rm(ws, { recursive: true, force: true })
      }
    }
  }
  return 0
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN)
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}
const fmt = (xs: number[], digits = 1) => (xs.length ? `${mean(xs).toFixed(digits)} ± ${sd(xs).toFixed(digits)}` : "—")

export function summarize(results: Result[]) {
  const byConfig = new Map<string, Result[]>()
  for (const r of results) byConfig.set(r.config, [...(byConfig.get(r.config) ?? []), r])
  return [...byConfig].map(([config, rs]) => ({
    config,
    runs: rs.length,
    passRate: rs.map((r) => (r.success ? 1 : 0)),
    wall: rs.map((r) => r.wallSeconds),
    cost: rs.flatMap((r) => (r.costUsd === null ? [] : [r.costUsd])),
  }))
}

async function report(): Promise<number> {
  const files = (await fs.readdir(resultsDir).catch(() => [] as string[])).filter((f) => f.endsWith(".jsonl"))
  const results: Result[] = []
  for (const f of files) {
    for (const line of (await fs.readFile(path.join(resultsDir, f), "utf8")).split("\n").filter(Boolean)) {
      results.push(JSON.parse(line))
    }
  }
  if (!results.length) {
    console.log("no results yet — run: node tools/eval.ts run --config <id>")
    return 0
  }
  const { baseline } = JSON.parse(await fs.readFile(path.join(evalDir, "configs.json"), "utf8")) as { baseline: string }
  const rows = summarize(results)
  console.log("| config | runs | held-out pass rate | wall seconds | cost USD |")
  console.log("| --- | --- | --- | --- | --- |")
  for (const r of rows)
    console.log(`| ${r.config} | ${r.runs} | ${fmt(r.passRate, 2)} | ${fmt(r.wall, 0)} | ${fmt(r.cost, 2)} |`)
  const base = rows.find((r) => r.config === baseline)
  if (!base) return 0
  console.log("\nRelease bar (vs baseline): pass rate ≥, cost <, wall time <")
  for (const r of rows.filter((x) => /^v2-(claude|codex|cursor)$/.test(x.config))) {
    const ok =
      mean(r.passRate) >= mean(base.passRate) && mean(r.cost) < mean(base.cost) && mean(r.wall) < mean(base.wall)
    console.log(`${ok ? "✓" : "✗"} ${r.config}`)
  }
  return 0
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  if (command === "validate") return validate(flag(args, "--task"))
  if (command === "run") {
    const config = flag(args, "--config")
    if (!config) throw new Error("run needs --config <id>")
    const restore = moveUserSkillsAside()
    try {
      return await runConfig(
        config,
        flag(args, "--task"),
        Number(flag(args, "--repeat") ?? 3),
        args.includes("--allow-unsandboxed"),
      )
    } finally {
      restore()
    }
  }
  if (command === "report") return report()
  console.error(
    "Usage: node tools/eval.ts validate [--task <id>] | run --config <id> [--task <id>] [--repeat 3] [--allow-unsandboxed] | report",
  )
  return 2
}

process.exitCode = await main(process.argv.slice(2))
