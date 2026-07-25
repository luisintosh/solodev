#!/usr/bin/env node
/**
 * Outcome evals on test/fixture-repo (evals/outcome/):
 *   validate   each task's held-out tests fail on the seeded fixture and pass with its reference solution (no agents)
 *   run        run /arise for a config over the tasks, then score with the held-out tests; appends to results/
 *   report     mean and spread per config, and the release bar against the baseline
 */
import { spawnSync } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const evalDir = path.join(root, "evals", "outcome")
const tasksDir = path.join(evalDir, "tasks")
const resultsDir = path.join(evalDir, "results")
const fixture = path.join(root, "test", "fixture-repo")

type Tool = "claude" | "codex" | "cursor"
type Config = { id: string; install: string; home: Tool; writer: Tool; suffix?: string; note?: string }
type Task = { id: string; shape: string; prompt: string }

export type Result = {
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
  costUsd: number | null
  inputTokens: number | null
  outputTokens: number | null
  gateCommit: boolean
  diffLines: number
}

function sh(cmd: string, args: string[], cwd: string, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
    timeout: opts.timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  })
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

async function copyDir(from: string, to: string) {
  await fs.cp(from, to, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) })
}

async function loadTasks(only?: string): Promise<Task[]> {
  const ids = (await fs.readdir(tasksDir)).sort().filter((id) => !only || id === only)
  if (only && !ids.length) throw new Error(`no task ${only}`)
  return Promise.all(
    ids.map(async (id) => ({ id, ...JSON.parse(await fs.readFile(path.join(tasksDir, id, "task.json"), "utf8")) })),
  )
}

/** A fresh git repo: the fixture plus the task's seed files, committed on main. */
async function workspace(task: Task): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), `solodev-eval-${task.id}-`))
  await copyDir(fixture, ws)
  const seed = path.join(tasksDir, task.id, "seed")
  if (await fs.stat(seed).catch(() => undefined)) await copyDir(seed, ws)
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "eval@example.com"],
    ["config", "user.name", "eval"],
    ["add", "-A"],
    ["commit", "-q", "-m", "chore: fixture"],
  ]) {
    sh("git", args, ws)
  }
  return ws
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
    const ws = await workspace(task)
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
    `/arise ${task.prompt}`,
    "",
    `This is an unattended eval run. I approve the spec as soon as you present it, and the coder is ${config.writer}.`,
    "There is no git remote: skip pushing, the pull request and PR comments, and stop once the work is committed and",
    "the checks for marking the PR ready would pass.",
    config.suffix ?? "",
  ]
    .join("\n")
    .trim()
}

function install(ws: string, config: Config) {
  const env = { TARGET_DIR: ws, INSTALL_SCOPE: "project", INSTALL_TARGET: "all", CI: "1" }
  const r =
    config.install === "local"
      ? sh(process.execPath, [path.join(root, "dist", "install.js"), "--yes"], ws, {
          env: { ...env, LOCAL_SOURCE: root },
        })
      : sh("npx", ["-y", `github:luisintosh/solodev#${config.install.replace(/^ref:/, "")}`, "--yes"], ws, { env })
  if (r.code !== 0) throw new Error(`install failed for ${config.id}: ${r.stderr.slice(-500)}`)
  sh("git", ["add", "-A"], ws)
  sh("git", ["commit", "-q", "-m", "chore: install solodev"], ws)
}

/** The headless command for each coding tool, with approvals off: evals run in a throwaway directory. */
function agentCommand(home: Tool, text: string): [string, string[]] {
  if (home === "claude")
    return ["claude", ["-p", text, "--output-format", "json", "--permission-mode", "bypassPermissions"]]
  if (home === "codex") return ["codex", ["exec", "--json", "--full-auto", text]]
  return ["cursor-agent", ["-p", text, "--output-format", "json", "--force"]]
}

function usage(stdout: string): Pick<Result, "costUsd" | "inputTokens" | "outputTokens"> {
  for (const line of stdout.trim().split("\n").reverse()) {
    try {
      const j = JSON.parse(line) as {
        total_cost_usd?: number
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      if (j.total_cost_usd !== undefined || j.usage) {
        return {
          costUsd: j.total_cost_usd ?? null,
          inputTokens: j.usage?.input_tokens ?? null,
          outputTokens: j.usage?.output_tokens ?? null,
        }
      }
    } catch {
      // not a JSON line
    }
  }
  return { costUsd: null, inputTokens: null, outputTokens: null }
}

async function runConfig(configId: string, only: string | undefined, repeats: number): Promise<number> {
  const { configs } = JSON.parse(await fs.readFile(path.join(evalDir, "configs.json"), "utf8")) as { configs: Config[] }
  const config = configs.find((c) => c.id === configId)
  if (!config) throw new Error(`no config ${configId}; see evals/outcome/configs.json`)
  await fs.mkdir(resultsDir, { recursive: true })
  const out = path.join(resultsDir, `${config.id}.jsonl`)
  for (const task of await loadTasks(only)) {
    for (let i = 1; i <= repeats; i++) {
      const ws = await workspace(task)
      try {
        install(ws, config)
        const base = sh("git", ["rev-parse", "HEAD"], ws).stdout.trim()
        const [cmd, args] = agentCommand(config.home, prompt(task, config))
        const started = Date.now()
        const agent = sh(cmd, args, ws, { timeoutMs: 60 * 60_000, env: { SOLODEV_HOME: config.home } })
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
          gateCommit: sh("git", ["log", "--grep", "Solodev-Gate: approved", "--format=%H"], ws).stdout.trim() !== "",
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
    return runConfig(config, flag(args, "--task"), Number(flag(args, "--repeat") ?? 3))
  }
  if (command === "report") return report()
  console.error(
    "Usage: node tools/eval.ts validate [--task <id>] | run --config <id> [--task <id>] [--repeat 3] | report",
  )
  return 2
}

process.exitCode = await main(process.argv.slice(2))
