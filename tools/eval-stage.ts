#!/usr/bin/env node
/**
 * Stage evals (evals/stages/<id>/): one step of a skill, started from a prepared repo and feature folder, run headless
 * with a turn cap, and graded by scripts that read git, the feature folder and the transcript.
 *   validate                     build each stage's starting point and check it (no agents)
 *   run [--tier smoke] [--stage <id>] [--changed [<ref>]] [--judge] [--keep]
 *                                run the selected stages; --changed keeps only those whose prompts changed since <ref>
 *                                (default master); --judge grades the `judge` expectations with one cheap model call
 */
import * as fsSync from "node:fs"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { z } from "zod"
import {
  CLAUDE_ALLOWED,
  copyDir,
  install,
  isDir,
  moveUserSkillsAside,
  root,
  STATE_DIR,
  sh,
  stateIn,
  usage,
  workspace,
} from "./eval-lib.ts"

const stagesDir = path.join(root, "evals", "stages")
const resultsDir = path.join(stagesDir, "results")

const Count = z.object({ min: z.number().optional(), max: z.number().optional() }).strict()
const Check = z
  .object({
    expect: z.string(),
    /** Behavior the workflow keeps whatever implements it; untagged checks test today's mechanism. */
    contract: z.boolean().optional(),
    count: Count.optional(),
    /** A path in the workspace; `{feature}` and `{state}` expand to the feature folder and the repo's state folder. */
    file: z.string().optional(),
    /** A git command; `{base}` expands to HEAD at the end of setup. Counts output lines, or `matches`. */
    git: z.array(z.string()).optional(),
    /** A tool the commander called (name regex), optionally with `input` matching and before its first `before` call. */
    tool: z.string().optional(),
    input: z.string().optional(),
    before: z.string().optional(),
    /** Commander text matching this regex; `final` looks only at the last message. */
    reply: z.string().optional(),
    final: z.boolean().optional(),
    /** `solodev status` names one of these stages. */
    status: z.array(z.string()).optional(),
    /** Counts feature folders. */
    features: z.literal(true).optional(),
    /** A command run in the workspace that has to exit with `exit` (default 0); `{base}`, `{feature}`, `{state}` and
     * `{stage}` (the stage's folder) expand in its arguments. */
    run: z.array(z.string()).min(1).optional(),
    exit: z.number().int().optional(),
    /** Graded by a model, and only with --judge. */
    judge: z.literal(true).optional(),
    matches: z.string().optional(),
  })
  .strict()
  .refine((c) => [c.file, c.git, c.tool, c.reply, c.status, c.features, c.run, c.judge].filter((k) => k).length === 1, {
    message: "each check needs exactly one of file, git, tool, reply, status, features, run, judge",
  })
const Stage = z
  .object({
    tier: z.enum(["smoke", "stage"]),
    skill: z.string(),
    /** Prompt names (skills and shadows) whose change selects this stage under --changed. */
    covers: z.array(z.string()).min(1),
    prompt: z.string(),
    maxTurns: z.number().int().positive(),
    /** Fixture files to delete before the first commit. */
    remove: z.array(z.string()).optional(),
    /** Run `npm ci` in setup, for stages whose journey tests need the fixture's dev dependencies. */
    npm: z.boolean().optional(),
    branch: z.string().optional(),
    slug: z.string().optional(),
    approve: z.boolean().optional(),
    /** Tools the agent may use beyond CLAUDE_ALLOWED, such as `Bash(gh:*)` for a stub in the stage's `bin/`. */
    allow: z.array(z.string()).optional(),
    /** What `solodev status` reports after setup, and a check set that must pass then. */
    start: z.object({ stage: z.string(), check: z.enum(["implement", "pr", "done"]).optional() }).optional(),
    checks: z.array(Check).min(1),
  })
  .strict()

type Stage = z.infer<typeof Stage> & { id: string }
type Check = z.infer<typeof Check>
type Event = { text: string } | { tool: string; input: string }
type Transcript = { events: Event[]; turns: number | null; subtype: string | null }
type Graded = { expect: string; contract: boolean; pass: boolean | null; detail: string }

async function loadStages(): Promise<Stage[]> {
  const stages: Stage[] = []
  for (const id of (await fs.readdir(stagesDir)).sort()) {
    const file = path.join(stagesDir, id, "stage.json")
    if (!(await fs.stat(file).catch(() => undefined))) continue
    const parsed = Stage.safeParse(JSON.parse(await fs.readFile(file, "utf8")))
    if (!parsed.success) throw new Error(`${path.relative(root, file)}: ${z.prettifyError(parsed.error)}`)
    for (const c of parsed.data.checks) for (const re of [c.input, c.reply, c.matches]) if (re) new RegExp(re)
    stages.push({ id, ...parsed.data })
  }
  return stages
}

const solodev = (ws: string, state: string, args: string[]) =>
  sh(process.execPath, [path.join(ws, ".agents", "solodev", "solodev-cli.mjs"), ...args], ws, {
    env: { SOLODEV_STATE: state, SOLODEV_HOME: "claude" },
    timeoutMs: 300_000,
  })

/** The workspace's folder of features: `<state>/<checkout name>`, since the workspace has no origin (state.ts). */
const repoState = (ws: string, state: string) => path.join(state, path.basename(ws))

/** The fixture with the stage's seed, solodev installed, and the feature folder and code the stage starts from. */
async function setup(stage: Stage): Promise<{ ws: string; state: string; base: string }> {
  const dir = path.join(stagesDir, stage.id)
  const ws = await workspace(stage.id, [path.join(dir, "seed")], stage.remove)
  install(ws, "local")
  const state = await stateIn(ws)
  if (stage.npm) {
    await fs.appendFile(path.join(ws, ".git", "info", "exclude"), "node_modules/\n")
    const r = sh("npm", ["ci", "--no-audit", "--no-fund", "--silent"], ws, { timeoutMs: 300_000 })
    if (r.code !== 0) throw new Error(`${stage.id}: npm ci failed: ${r.stderr.slice(-500)}`)
  }
  if (stage.branch) sh("git", ["checkout", "-q", "-b", stage.branch], ws)
  if (await isDir(path.join(dir, "feature"))) {
    if (!stage.slug) throw new Error(`${stage.id}: a feature/ folder needs a slug`)
    await copyDir(path.join(dir, "feature"), path.join(repoState(ws, state), stage.slug))
  }
  if (stage.approve) {
    const r = solodev(ws, state, ["approve", stage.slug!])
    if (r.code !== 0) throw new Error(`${stage.id}: solodev approve failed: ${r.stdout}${r.stderr}`)
  }
  if (await isDir(path.join(dir, "code"))) {
    await copyDir(path.join(dir, "code"), ws)
    sh("git", ["add", "-A"], ws)
    sh("git", ["commit", "-q", "-m", `feat: ${stage.slug ?? stage.id}`], ws)
  }
  return { ws, state, base: sh("git", ["rev-parse", "HEAD"], ws).stdout.trim() }
}

/** Problems with the stage's starting point: the status it should report and the check set that should pass. */
function startProblems(stage: Stage, ws: string, state: string): string[] {
  if (!stage.start) return []
  const problems: string[] = []
  const status = solodev(ws, state, ["status", stage.slug!, "--json"])
  const got = (() => {
    try {
      return (JSON.parse(status.stdout) as { stage?: string }).stage
    } catch {
      return undefined
    }
  })()
  if (got !== stage.start.stage)
    problems.push(`status is ${got ?? status.stdout + status.stderr}, not ${stage.start.stage}`)
  if (stage.start.check) {
    const r = solodev(ws, state, ["check", stage.slug!, "--for", stage.start.check])
    if (r.code !== 0) problems.push(`check --for ${stage.start.check} failed:\n${r.stdout}${r.stderr}`)
  }
  return problems
}

async function validate(): Promise<number> {
  let problems = 0
  for (const stage of await loadStages()) {
    const { ws, state } = await setup(stage)
    try {
      const found = startProblems(stage, ws, state)
      problems += found.length
      console.log(`${found.length ? "✗" : "✓"} ${stage.id} (${stage.tier}, ${stage.skill})`)
      for (const p of found) console.log(`  ${p}`)
    } finally {
      await fs.rm(ws, { recursive: true, force: true })
    }
  }
  return problems ? 1 : 0
}

/** The commander's messages and tool calls (subagents' are left out), from Claude Code's stream-json output. */
export function parseTranscript(stdout: string): Transcript {
  const events: Event[] = []
  let turns: number | null = null
  let subtype: string | null = null
  for (const line of stdout.split("\n")) {
    let j: {
      type?: string
      subtype?: string
      num_turns?: number
      parent_tool_use_id?: string | null
      message?: { content?: { type: string; text?: string; name?: string; input?: unknown }[] }
    }
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.type === "result") {
      turns = j.num_turns ?? null
      subtype = j.subtype ?? null
    }
    if (j.type !== "assistant" || j.parent_tool_use_id) continue
    for (const c of j.message?.content ?? []) {
      if (c.type === "text" && c.text) events.push({ text: c.text })
      if (c.type === "tool_use") events.push({ tool: c.name ?? "", input: JSON.stringify(c.input ?? {}) })
    }
  }
  return { events, turns, subtype }
}

function inRange(n: number, count: Check["count"]): boolean {
  // No count means "at least one"; a count with only max allows zero.
  const { min = 0, max = Number.POSITIVE_INFINITY } = count ?? { min: 1 }
  return n >= min && n <= max
}

const countMatches = (text: string, re: string) => [...text.matchAll(new RegExp(re, "gim"))].length

/** Grades every check except `judge`, which stays null for gradeJudged. */
export async function grade(
  checks: Check[],
  t: Transcript,
  ctx: { ws: string; state: string; base: string; slug?: string; stageDir?: string },
): Promise<Graded[]> {
  const repo = repoState(ctx.ws, ctx.state)
  const features = await fs.readdir(repo).catch(() => [] as string[])
  const featureDirs = features.filter((f) => f !== "roadmaps")
  const slug = ctx.slug ?? featureDirs[0]
  const expand = (s: string) =>
    s
      .replaceAll("{feature}", path.join(repo, slug ?? "<no feature>"))
      .replaceAll("{state}", repo)
      .replaceAll("{base}", ctx.base)
      .replaceAll("{stage}", ctx.stageDir ?? "<no stage>")
  const texts = t.events.flatMap((e) => ("text" in e ? [e.text] : []))
  const out: Graded[] = []
  for (const c of checks) {
    const contract = c.contract ?? false
    let n = 0
    let detail = ""
    if (c.judge) {
      out.push({ expect: c.expect, contract, pass: null, detail: "judge" })
      continue
    }
    if (c.run) {
      const [cmd, ...args] = c.run.map(expand)
      const r = sh(cmd!, args, ctx.ws, { timeoutMs: 300_000 })
      const want = c.exit ?? 0
      const tail = `${r.stdout}${r.stderr}`.trim().split("\n").slice(-3).join(" | ")
      out.push({ expect: c.expect, contract, pass: r.code === want, detail: `exit ${r.code} (want ${want}): ${tail}` })
      continue
    }
    if (c.file) {
      const resolved = path.resolve(ctx.ws, expand(c.file))
      const body = await fs
        .readFile(resolved, "utf8")
        .catch((err: NodeJS.ErrnoException) => (err.code === "EISDIR" ? "" : undefined))
      n = body === undefined ? 0 : c.matches ? countMatches(body, c.matches) : 1
      detail = `${path.relative(ctx.ws, resolved)}: ${n}`
    } else if (c.git) {
      const r = sh("git", c.git.map(expand), ctx.ws)
      const lines = r.stdout.split("\n").filter(Boolean)
      n = c.matches ? lines.filter((l) => new RegExp(c.matches!, "i").test(l)).length : lines.length
      detail = `git ${c.git.join(" ")}: ${lines.slice(0, 5).join(" | ") || "(empty)"}`
    } else if (c.tool) {
      const name = new RegExp(`^(?:${c.tool})$`)
      const cut = c.before ? t.events.findIndex((e) => "tool" in e && new RegExp(`^(?:${c.before})$`).test(e.tool)) : -1
      const window = cut === -1 ? t.events : t.events.slice(0, cut)
      n = window.filter(
        (e) => "tool" in e && name.test(e.tool) && (!c.input || new RegExp(c.input, "i").test(e.input)),
      ).length
      detail = `${n} call${n === 1 ? "" : "s"}`
    } else if (c.reply) {
      n = countMatches(c.final ? (texts.at(-1) ?? "") : texts.join("\n"), c.reply)
      detail = `${n} match${n === 1 ? "" : "es"}`
    } else if (c.status) {
      const r = slug ? solodev(ctx.ws, ctx.state, ["status", slug, "--json"]) : undefined
      let stage = "no feature"
      try {
        stage = (JSON.parse(r?.stdout ?? "") as { stage: string }).stage
      } catch {
        // stays "no feature"
      }
      out.push({ expect: c.expect, contract, pass: c.status.includes(stage), detail: `status: ${stage}` })
      continue
    } else if (c.features) {
      n = featureDirs.length
      detail = `${n} feature folder${n === 1 ? "" : "s"}`
    }
    out.push({ expect: c.expect, contract, pass: inRange(n, c.count), detail })
  }
  return out
}

/** One cheap model call grades every `judge` expectation against the commander's messages. */
function gradeJudged(graded: Graded[], t: Transcript): Graded[] {
  const pending = graded.filter((g) => g.pass === null)
  if (!pending.length) return graded
  const log = t.events
    .map((e) => ("text" in e ? `ASSISTANT: ${e.text}` : `TOOL ${e.tool}: ${e.input.slice(0, 200)}`))
    .join("\n")
    .slice(-30_000)
  const text = [
    "Grade an AI coding agent's run against each expectation, strictly, from this log of its messages and tool calls.",
    'Answer with only a JSON array: [{"n": 1, "pass": true, "why": "<one line>"}, ...].',
    "",
    ...pending.map((g, i) => `${i + 1}. ${g.expect}`),
    "",
    "<log>",
    log,
    "</log>",
  ].join("\n")
  const r = sh("claude", ["-p", text, "--model", "haiku", "--tools", "", "--output-format", "json"], os.tmpdir(), {
    timeoutMs: 180_000,
  })
  let verdicts: { n: number; pass: boolean; why: string }[] = []
  try {
    const answer = (JSON.parse(r.stdout) as { result: string }).result
    verdicts = JSON.parse(answer.slice(answer.indexOf("["), answer.lastIndexOf("]") + 1))
  } catch {
    // leave them ungraded
  }
  return graded.map((g) => {
    const i = pending.indexOf(g)
    const v = i === -1 ? undefined : verdicts.find((x) => x.n === i + 1)
    return v ? { ...g, pass: v.pass, detail: `judge: ${v.why}` } : g
  })
}

/** Paths the --changed selection maps to prompt names; `*` selects every stage. */
export function changedPrompts(files: string[]): Set<string> {
  const out = new Set<string>()
  for (const f of files) {
    const prompt = f.match(/^src\/prompts\/(?:skills\/([^/]+)\/|agents\/([^/]+)\.md$)/)
    const stage = f.match(/^evals\/stages\/([^/]+)\//)
    if (prompt) out.add(prompt[1] ?? prompt[2]!)
    else if (stage) out.add(`stage:${stage[1]}`)
    else if (
      /^(src\/prompts\/fragments\/|src\/catalog\.yaml$|src\/cli\/(?!.*\.test\.ts$)|tools\/(transpile|eval-lib|eval-stage)\.ts$)/.test(
        f,
      )
    )
      out.add("*")
  }
  return out
}

function changedFiles(ref: string): string[] {
  const lists = [
    ["diff", "--name-only", `${ref}...HEAD`],
    ["diff", "--name-only", "HEAD"],
    ["ls-files", "--others", "--exclude-standard"],
  ].map((args) => sh("git", args, root).stdout.split("\n").filter(Boolean))
  return [...new Set(lists.flat())]
}

/** The stage's `bin/` goes first on PATH, so a stub such as a fake `gh` stands in for the real tool. */
function agentEnv(stage: Stage, state: string): NodeJS.ProcessEnv {
  const bin = path.join(stagesDir, stage.id, "bin")
  return {
    SOLODEV_HOME: "claude",
    SOLODEV_STATE: state,
    ...(fsSync.existsSync(bin) ? { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` } : {}),
  }
}

function prompt(stage: Stage): string {
  return stage.prompt.startsWith("/") ? stage.prompt : `/${stage.skill} ${stage.prompt}`
}

async function runStages(args: string[]): Promise<number> {
  if (!(await isDir(path.join(root, "dist")))) throw new Error("no dist/: run `pnpm run build` first")
  const tier = flag(args, "--tier")
  const only = flag(args, "--stage")
  let stages = (await loadStages()).filter((s) => (!tier || s.tier === tier) && (!only || s.id === only))
  if (args.includes("--changed")) {
    const ref = flag(args, "--changed")
    const changed = changedPrompts(changedFiles(ref && !ref.startsWith("--") ? ref : "master"))
    stages = stages.filter(
      (s) => changed.has("*") || changed.has(`stage:${s.id}`) || s.covers.some((c) => changed.has(c)),
    )
    if (!stages.length) console.log("no stage covers a changed prompt")
  }
  await fs.mkdir(resultsDir, { recursive: true })
  let failed = 0
  for (const stage of stages) {
    const { ws, state, base } = await setup(stage)
    try {
      const problems = startProblems(stage, ws, state)
      if (problems.length) throw new Error(`${stage.id}: bad starting point: ${problems.join("; ")}`)
      const started = Date.now()
      const agent = sh(
        "claude",
        [
          "-p",
          prompt(stage),
          "--output-format",
          "stream-json",
          "--verbose",
          "--max-turns",
          String(stage.maxTurns),
          "--allowedTools",
          [...CLAUDE_ALLOWED, ...(stage.allow ?? [])].join(" "),
        ],
        ws,
        { timeoutMs: 30 * 60_000, env: agentEnv(stage, state) },
      )
      const wallSeconds = Math.round((Date.now() - started) / 1000)
      const transcriptFile = path.join(os.tmpdir(), `solodev-stage-${stage.id}-${Date.now()}.jsonl`)
      await fs.writeFile(transcriptFile, agent.stdout)
      const t = parseTranscript(agent.stdout)
      const stageDir = path.join(stagesDir, stage.id)
      let graded = await grade(stage.checks, t, { ws, state, base, slug: stage.slug, stageDir })
      if (args.includes("--judge")) graded = gradeJudged(graded, t)
      const passed = graded.filter((g) => g.pass === true).length
      const failures = graded.filter((g) => g.pass === false)
      const skipped = graded.filter((g) => g.pass === null).length
      const contract = graded.filter((g) => g.contract)
      const contractFailed = contract.filter((g) => g.pass === false).length
      if (failures.length) failed++
      const cost = usage(agent.stdout).costUsd
      await fs.appendFile(
        path.join(resultsDir, `${stage.id}.jsonl`),
        `${JSON.stringify({ stage: stage.id, date: new Date().toISOString(), passed, failed: failures.length, contractFailed, skipped, turns: t.turns, endedBy: t.subtype, wallSeconds, costUsd: cost, failures: failures.map((f) => f.expect) })}\n`,
      )
      console.log(
        `${failures.length ? "✗" : "✓"} ${stage.id}: ${passed}/${graded.length - skipped} checks${skipped ? ` (${skipped} judge skipped)` : ""} · contract ${contract.length - contractFailed}/${contract.length} · ${t.turns ?? "?"} turns${t.subtype === "error_max_turns" ? " (hit the cap)" : ""} · ${wallSeconds}s · $${cost?.toFixed(2) ?? "?"}`,
      )
      for (const f of failures) console.log(`  ✗ ${f.contract ? "[contract] " : ""}${f.expect} — ${f.detail}`)
      console.log(`  transcript: ${transcriptFile}`)
      if (args.includes("--keep")) console.log(`  workspace: ${ws} (state in ${STATE_DIR}/)`)
    } finally {
      if (!args.includes("--keep")) await fs.rm(ws, { recursive: true, force: true })
    }
  }
  return failed ? 1 : 0
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  if (command === "validate") return validate()
  if (command === "run") {
    const restore = moveUserSkillsAside()
    try {
      return await runStages(args)
    } finally {
      restore()
    }
  }
  console.error(
    "Usage: node tools/eval-stage.ts validate | run [--tier smoke|stage] [--stage <id>] [--changed [<ref>]] [--judge] [--keep]",
  )
  return 2
}

if (process.argv[1] === import.meta.filename) process.exitCode = await main(process.argv.slice(2))
