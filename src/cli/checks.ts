import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { type ExecResult, run, shell, tail } from "./exec.ts"
import {
  currentApproval,
  exists,
  parseCommands,
  parsePlan,
  parseQa,
  parseReview,
  parseScenarios,
  type Plan,
  readIfExists,
  SEVERITIES,
  STATUSES,
} from "./feature.ts"
import { firstAdded, git, resolveBase } from "./git.ts"

export type CheckStatus = "pass" | "fail" | "warn" | "skip"
export type CheckResult = {
  id: string
  title: string
  status: CheckStatus
  summary: string
  /** Shown when the check doesn't pass. */
  details: string[]
  /** Always shown: what a reviewer needs even on a pass. */
  evidence?: string[]
}

export const CHECK_IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"] as const
export type CheckId = (typeof CHECK_IDS)[number]

export const CHECK_SETS = {
  implement: ["C1", "C2", "C3", "C4", "C5", "C9"],
  pr: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C9"],
  done: [...CHECK_IDS],
} as const satisfies Record<string, readonly CheckId[]>

export type CheckSet = keyof typeof CHECK_SETS

export type CheckContext = {
  /** The project. */
  root: string
  /** The feature folder, outside the project (state.ts). */
  dir: string
  set: CheckSet
  /** Per command; journey tests and AGENTS.md commands each get this long. */
  timeoutMs: number
  env?: Record<string, string | undefined>
}

const TITLES: Record<CheckId, string> = {
  C1: "commands",
  C2: "scenario coverage",
  C3: "fail then pass",
  C4: "tests not weakened",
  C5: "gate held",
  C6: "reports only",
  C7: "review settled",
  C8: "QA verdicts",
  C9: "config documented",
}

const result = (id: CheckId, status: CheckStatus, summary: string, details: string[] = []): CheckResult => ({
  id,
  title: TITLES[id],
  status,
  summary,
  details,
})

async function loadPlan(dir: string): Promise<Plan> {
  const raw = await readIfExists(path.join(dir, "plan.md"))
  if (raw === undefined) throw new Error(`plan.md not found in ${dir}`)
  return parsePlan(raw)
}

/** The code without the feature: where the branch forked from the default branch. */
const baseOf = (ctx: CheckContext) => resolveBase(ctx.root, { ...process.env, ...ctx.env })

const NO_BASE = "can't find the base branch — set SOLODEV_BASE"

async function c1(ctx: CheckContext): Promise<CheckResult> {
  // /solodev-scout is optional: a command AGENTS.md doesn't list is skipped here and run by the agent that found it.
  const commands = parseCommands((await readIfExists(path.join(ctx.root, "AGENTS.md"))) ?? "")
  const names = ctx.set === "implement" ? ["typecheck", "lint"] : ["typecheck", "lint", "test", "build"]
  const unlisted = names.filter((name) => !commands.has(name))
  if (unlisted.length === names.length) {
    return result("C1", "skip", "no commands in AGENTS.md; run them yourself (optional: /solodev-scout)")
  }
  const parts: string[] = []
  const details: string[] = []
  let failed = false
  for (const name of names) {
    if (!commands.has(name)) {
      parts.push(`${name} not listed`)
      details.push(`${name} not in AGENTS.md; run it yourself (optional: /solodev-scout lists it for next time)`)
      continue
    }
    const command = commands.get(name)
    if (command === null) {
      parts.push(`${name} n/a`)
      continue
    }
    const r = await shell(command!, ctx.root, ctx.timeoutMs)
    if (r.code === 0) {
      parts.push(`${name} pass`)
    } else {
      failed = true
      parts.push(`${name} FAIL`)
      details.push(`$ ${command}`, ...tail(r).map((l) => `  ${l}`))
    }
  }
  return result("C1", failed ? "fail" : "pass", parts.join(" · "), details)
}

/** C2. At the gate the journey tests don't exist yet, so `requireTests` is off there. */
export async function coverage(root: string, dir: string, requireTests: boolean): Promise<CheckResult> {
  const spec = await readIfExists(path.join(dir, "spec.md"))
  if (spec === undefined) return result("C2", "fail", `spec.md not found in ${dir}`)
  const scenarios = parseScenarios(spec)
  if (!scenarios.length) return result("C2", "fail", "spec.md has no @S<n> scenarios")
  let plan: Plan
  try {
    plan = await loadPlan(dir)
  } catch (err) {
    return result("C2", "fail", (err as Error).message)
  }
  const claimed = new Set([...plan.journeys.flatMap((j) => j.scenarios), ...plan.uncovered])
  const details: string[] = []
  const unclaimed = scenarios.filter((s) => !claimed.has(s))
  if (unclaimed.length) details.push(`no journey or uncovered entry claims ${unclaimed.join(", ")}`)
  const unknown = [...claimed].filter((s) => !scenarios.includes(s))
  if (unknown.length) details.push(`plan.md names ${unknown.join(", ")}, which spec.md doesn't define`)
  for (const j of plan.journeys) {
    if (requireTests && !(await exists(path.join(root, j.test)))) {
      details.push(`${j.id}: test file ${j.test} does not exist`)
    }
  }
  if (details.length) return result("C2", "fail", details[0]!, details.slice(1))
  const tests = plan.journeys.length
  const uncovered = plan.uncovered.length ? `, ${plan.uncovered.length} left to QA` : ""
  return result(
    "C2",
    "pass",
    `${scenarios.length} scenarios, ${tests} journey test${tests === 1 ? "" : "s"}${uncovered}`,
  )
}

const c2 = (ctx: CheckContext) => coverage(ctx.root, ctx.dir, true)

/** Dependency folders a temporary worktree borrows from the checkout instead of reinstalling. */
const DEPENDENCY_DIRS = ["node_modules", ".venv", "venv", "vendor"]

/** Lines where a runner says the test never loaded: node, vitest, jest, mocha, pytest and go. */
const LOAD_ERROR =
  /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to (?:load|resolve import)|does not provide an export named|ModuleNotFoundError|No module named|ImportError|cannot import name|SyntaxError|error collecting|No test files? found|no tests ran|collected 0 items|cannot find package|\[(?:build|setup) failed\]/i

export type BaseFailure =
  | { kind: "behavior" }
  | { kind: "new"; file: string }
  | { kind: "load"; line: string }
  | { kind: "broken"; line: string }

/**
 * Why a journey test failed against the code before the feature. `changed` holds the files the feature adds or edits,
 * journey tests excluded: a load error naming one of them is expected (the test imports new code), one naming none
 * means the test may never have run for a reason unrelated to the feature.
 */
export function baseFailure(r: ExecResult, changed: string[]): BaseFailure {
  if (r.code === null || r.code === 126 || r.code === 127) return { kind: "broken", line: tail(r, 1)[0]?.trim() ?? "" }
  const loads = `${r.stdout}\n${r.stderr}`.split("\n").filter((l) => LOAD_ERROR.test(l))
  if (!loads.length) return { kind: "behavior" }
  for (const line of loads) {
    const file = changed.find((f) => moduleNames(f).some((n) => n.test(line)))
    if (file) return { kind: "new", file }
  }
  // Node prints the throwing source line first; the line that quotes a path or name says more.
  return { kind: "load", line: (loads.find((l) => /['"`]/.test(l)) ?? loads[0]!).trim() }
}

/** How an import names `file`: as is, without its extension or index file, and as a dotted Python module. */
function moduleNames(file: string): RegExp[] {
  const bare = file.replace(/\.[^./]+$/, "").replace(/\/(?:index|__init__)$/, "")
  const literal = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return [...new Set([file, bare, bare.replaceAll("/", ".")])].map(
    (n) => new RegExp(`(?<![\\w-])${literal(n)}(?![\\w-])`),
  )
}

async function c3(ctx: CheckContext): Promise<CheckResult> {
  const base = await baseOf(ctx)
  if (!base) return result("C3", "fail", NO_BASE)
  let plan: Plan
  try {
    plan = await loadPlan(ctx.dir)
  } catch (err) {
    return result("C3", "fail", (err as Error).message)
  }
  if (!plan.journeys.length) return result("C3", "pass", "no journey tests to prove")
  const details: string[] = []
  const evidence: string[] = []
  const parts = new Map<string, string>()
  let status: CheckStatus = "pass"
  // HEAD first: a journey that fails now needs no base run, and a fix loop is mostly that case.
  const green: typeof plan.journeys = []
  for (const j of plan.journeys) {
    const after = await shell(j.command, ctx.root, ctx.timeoutMs)
    if (after.code === 0) {
      green.push(j)
      continue
    }
    status = "fail"
    parts.set(j.id, `${j.id} FAILS now`)
    details.push(`${j.id}: \`${j.command}\` fails at HEAD:`, ...tail(after).map((l) => `  ${l}`))
  }
  if (green.length) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "solodev-c3-"))
    const worktree = path.join(tmp, "base")
    try {
      const journeyTests = new Set(plan.journeys.map((j) => j.test))
      const changed = [
        ...(await git(ctx.root, ["diff", "--name-only", base])).split("\n"),
        ...(await git(ctx.root, ["ls-files", "--others", "--exclude-standard"])).split("\n"),
      ].filter((f) => f && !journeyTests.has(f))
      await git(ctx.root, ["worktree", "add", "--detach", "--quiet", worktree, base])
      for (const dir of DEPENDENCY_DIRS) {
        const from = path.join(ctx.root, dir)
        if ((await exists(from)) && !(await exists(path.join(worktree, dir)))) {
          await fs.symlink(from, path.join(worktree, dir))
        }
      }
      for (const j of plan.journeys) {
        const dest = path.join(worktree, j.test)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.copyFile(path.join(ctx.root, j.test), dest)
      }
      for (const j of green) {
        const before = await shell(j.command, worktree, ctx.timeoutMs)
        if (before.code === 0) {
          status = "fail"
          parts.set(j.id, `${j.id} passes at base`)
          details.push(
            `${j.id}: \`${j.command}\` passes against the code before the feature, so it doesn't prove the change`,
          )
          continue
        }
        const why = baseFailure(before, changed)
        if (why.kind === "broken") {
          status = "fail"
          parts.set(j.id, `${j.id} never ran at base`)
          details.push(
            `${j.id}: \`${j.command}\` couldn't run against the code before the feature (${why.line}), so it doesn't prove the change`,
          )
          continue
        }
        if (why.kind === "load") {
          if (status === "pass") status = "warn"
          parts.set(j.id, `${j.id} didn't load at base`)
          details.push(
            `${j.id}: before the feature the test failed to load on \`${why.line}\`, which names nothing the feature adds or changes: a generated or ignored file, a typo'd import or a broken test?`,
          )
        } else {
          parts.set(j.id, why.kind === "new" ? `${j.id} red (new ${why.file})→green` : `${j.id} red→green`)
        }
        // The reviewer judges whether the test failed for the right reason (missing behavior, not a broken test).
        const reason = why.kind === "new" ? " loading new code, so no assertion ran" : ""
        evidence.push(`${j.id} failed before the feature${reason}:`, ...tail(before, 8).map((l) => `  ${l}`))
      }
    } catch (err) {
      status = "fail"
      details.unshift((err as Error).message)
      parts.set("", "could not run")
    } finally {
      await run("git", ["worktree", "remove", "--force", worktree], { cwd: ctx.root })
      await fs.rm(tmp, { recursive: true, force: true })
      await run("git", ["worktree", "prune"], { cwd: ctx.root })
    }
  }
  const summary = [...plan.journeys.map((j) => parts.get(j.id)), parts.get("")].filter(Boolean).join(" · ")
  return { ...result("C3", status, summary, details), evidence }
}

// Heuristics (spike 7): markers that skip or focus a test, and the common assertion forms of JS, Python and Go runners.
const SKIP_MARKERS =
  /\b(?:it|test|describe|context|suite)\.(?:skip|only|todo)\b|\bx(?:it|test|describe)\s*\(|\bf(?:it|describe)\s*\(|@pytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.skip\s*\(|\bt\.Skip(?:Now|f)?\s*\(|@(?:Disabled|Ignore)\b/g
const ASSERTIONS =
  /\bexpect\s*\(|\bassert(?:_\w+|\w*)?\s*[(.\s]|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\.should\b|\brequire\.\w+\s*\(/g

const count = (text: string, re: RegExp) => [...text.matchAll(re)].length

/** Test files by the common JS, Python and Go naming conventions. */
const TEST_FILE =
  /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/

async function c4(ctx: CheckContext): Promise<CheckResult> {
  let plan: Plan
  try {
    plan = await loadPlan(ctx.dir)
  } catch (err) {
    return result("C4", "fail", (err as Error).message)
  }
  const details: string[] = []
  let deleted = false
  let flagged = false
  let checked = 0

  /** Compares a test's current text with `original` (its text at `ref`). */
  const compare = async (file: string, original: string, ref: string) => {
    checked++
    const short = ref.slice(0, 7)
    const current = await readIfExists(path.join(ctx.root, file))
    if (current === undefined) {
      deleted = true
      details.push(`${file} was deleted since ${short}`)
      return
    }
    const skips = count(current, SKIP_MARKERS) - count(original, SKIP_MARKERS)
    const lost = count(original, ASSERTIONS) - count(current, ASSERTIONS)
    if (skips > 0 || lost > 0) {
      flagged = true
      const what = [
        skips > 0 ? `${skips} skip/only marker(s) added` : "",
        lost > 0 ? `${lost} assertion(s) removed` : "",
      ]
      details.push(
        `${file}: ${what.filter(Boolean).join(", ")} since ${short} — show the user \`git diff ${short} -- ${file}\` and ask`,
      )
    }
  }

  // Journey tests: against the version first committed, which is the contract.
  const journeyTests = new Set(plan.journeys.map((j) => j.test))
  for (const test of journeyTests) {
    const first = await firstAdded(ctx.root, test)
    if (first) await compare(test, await git(ctx.root, ["show", `${first}:${test}`]), first)
  }

  // Every other test the feature touched: against the base, where it already protected existing behavior.
  const base = await baseOf(ctx)
  if (base) {
    const changed = (await git(ctx.root, ["diff", "--name-only", base])).split("\n").filter(Boolean)
    for (const file of changed) {
      if (journeyTests.has(file) || !TEST_FILE.test(file)) continue
      const before = await run("git", ["show", `${base}:${file}`], { cwd: ctx.root })
      if (before.code === 0) await compare(file, before.stdout, base)
    }
  }

  if (deleted) return result("C4", "fail", details[0]!, details.slice(1))
  if (flagged) return result("C4", "warn", "a test may have been weakened", details)
  if (!checked) return result("C4", "skip", "no committed test to compare yet")
  return result("C4", "pass", `${checked} test${checked === 1 ? "" : "s"} unchanged in strength`)
}

async function c5(ctx: CheckContext): Promise<CheckResult> {
  const { approval, matches } = await currentApproval(ctx.dir)
  if (!approval) return result("C5", "fail", "not approved — run solodev approve at the spec gate")
  if (!matches)
    return result("C5", "fail", "spec.md or plan.md changed since approval — show the user and approve again")
  const base = await baseOf(ctx)
  if (!base) return result("C5", "fail", NO_BASE)
  const ancestor = await run("git", ["merge-base", "--is-ancestor", approval.at, "HEAD"], { cwd: ctx.root })
  if (ancestor.code !== 0) {
    return result(
      "C5",
      "fail",
      `approved at ${approval.at}, which isn't in this branch — it was rewritten; approve again`,
    )
  }
  const early = (await git(ctx.root, ["log", "--format=%h %s", `${base}..${approval.at}`])).split("\n").filter(Boolean)
  if (early.length) {
    return result("C5", "fail", `${early.length} commit(s) before the approval`, early.slice(0, 20))
  }
  return result("C5", "pass", `approved ${approval.date} at ${approval.at.slice(0, 7)}, no code before it`)
}

async function c6(ctx: CheckContext): Promise<CheckResult> {
  // Reports live in the feature folder, outside the project, so any tracked change left behind is a stray edit.
  const dirty = (await git(ctx.root, ["status", "--porcelain", "--untracked-files=no"])).split("\n").filter(Boolean)
  if (dirty.length) {
    return result(
      "C6",
      "fail",
      "uncommitted changes in the project",
      dirty.map((l) => l.slice(3).trim()),
    )
  }
  return result("C6", "pass", "no uncommitted changes in the project")
}

async function c7(ctx: CheckContext): Promise<CheckResult> {
  const raw = await readIfExists(path.join(ctx.dir, "review.md"))
  if (raw === undefined) return result("C7", "fail", "no review.md — run solodev-review")
  const findings = parseReview(raw)
  const bad = findings.filter(
    (f) =>
      !(SEVERITIES as readonly string[]).includes(f.severity) || !(STATUSES as readonly string[]).includes(f.status),
  )
  if (bad.length) {
    return result(
      "C7",
      "fail",
      "review.md has rows with an unknown severity or status",
      bad.map((f) => `${f.id}: severity "${f.severity}", status "${f.status}"`),
    )
  }
  const open = findings.filter((f) => f.status === "open" && (f.severity === "blocker" || f.severity === "major"))
  if (open.length) {
    return result(
      "C7",
      "fail",
      `${open.length} open blocker/major`,
      open.map((f) => `${f.id} ${f.severity} ${f.location} ${f.summary}`),
    )
  }
  return result(
    "C7",
    "pass",
    `${findings.length} finding${findings.length === 1 ? "" : "s"}, none open at blocker/major`,
  )
}

/** `waived` is the user's call on a scenario nobody could automate; the finish card lists it. */
const PASSING_VERDICTS = ["pass", "waived"]

async function c8(ctx: CheckContext): Promise<CheckResult> {
  let plan: Plan
  try {
    plan = await loadPlan(ctx.dir)
  } catch (err) {
    return result("C8", "fail", (err as Error).message)
  }
  if (!plan.uncovered.length) return result("C8", "pass", "every scenario has a journey test")
  const raw = await readIfExists(path.join(ctx.dir, "qa.md"))
  if (raw === undefined) return result("C8", "fail", `no qa.md for ${plan.uncovered.join(", ")} — run solodev-verify`)
  const verdicts = parseQa(raw)
  const details: string[] = []
  for (const s of plan.uncovered) {
    const v = verdicts.get(s)
    if (!v) details.push(`${s} has no verdict in qa.md`)
    else if (v.verdict === "manual") details.push(`${s} needs a person: ask the user to check it or waive it`)
    else if (!PASSING_VERDICTS.includes(v.verdict)) details.push(`${s} ${v.verdict}: ${v.evidence}`)
  }
  if (details.length) return result("C8", "fail", details[0]!, details.slice(1))
  return result("C8", "pass", `${plan.uncovered.length} uncovered scenario(s) verified`)
}

// Literal env var reads in JS/TS, Python, Go, Ruby, Rust and Java; a computed name (`process.env[key]`) can't be checked.
const ENV_READS = new RegExp(
  [
    String.raw`\bprocess\.env\.([A-Z][A-Z0-9_]*)`,
    String.raw`\bprocess\.env\[\s*["'\`]([A-Z][A-Z0-9_]*)["'\`]\s*\]`,
    String.raw`\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)`,
    String.raw`\b(?:Deno\.env\.get|os\.getenv|os\.environ\.get|os\.Getenv|ENV\.fetch|env::var|System\.getenv)\(\s*["'\`]([A-Z][A-Z0-9_]*)["'\`]`,
    String.raw`(?:\bos\.environ|\bENV)\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]`,
  ].join("|"),
  "g",
)

/** Set by the runtime or the shell, not by whoever deploys the feature. */
const RUNTIME_VARS = new Set(["NODE_ENV", "CI", "HOME", "PATH", "PWD", "USER", "SHELL", "TERM", "TMPDIR"])

/** Where a variable counts as documented: any README, docs/, or an env template. */
const CONFIG_DOCS = [":(glob)**/README.md", ":(glob)docs/**", ".env.example", ".env.sample", ".env.template"]

const skipForEnv = (file: string) => TEST_FILE.test(file) || file.endsWith(".md")

/** Variable name → first file that reads it, from lines added since the base, committed or not. */
async function envReads(root: string, base: string): Promise<Map<string, string>> {
  const reads = new Map<string, string>()
  const scan = (file: string, text: string) => {
    if (skipForEnv(file)) return
    for (const m of text.matchAll(ENV_READS)) {
      const name = m.slice(1).find(Boolean)!
      if (!RUNTIME_VARS.has(name) && !reads.has(name)) reads.set(name, file)
    }
  }
  let file = ""
  for (const line of (await git(root, ["diff", "-U0", "--no-color", base])).split("\n")) {
    if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "")
    else if (line.startsWith("+")) scan(file, line.slice(1))
  }
  for (const f of (await git(root, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean)) {
    if (!skipForEnv(f)) scan(f, (await readIfExists(path.join(root, f))) ?? "")
  }
  return reads
}

async function c9(ctx: CheckContext): Promise<CheckResult> {
  const base = await baseOf(ctx)
  if (!base) return result("C9", "fail", NO_BASE)
  const reads = await envReads(ctx.root, base)
  if (!reads.size) return result("C9", "pass", "no new env reads")
  const patterns = [...reads.keys()].flatMap((name) => ["-e", name])
  const found = await run("git", ["grep", "--untracked", "-h", "-o", "-w", ...patterns, "--", ...CONFIG_DOCS], {
    cwd: ctx.root,
  })
  const documented = new Set(found.stdout.split("\n").map((l) => l.trim()))
  const missing = [...reads].filter(([name]) => !documented.has(name))
  if (missing.length) {
    return result(
      "C9",
      "fail",
      `${missing.length} env var(s) read but not documented`,
      missing.map(
        ([name, file]) => `${name} read in ${file} — add it to the owning README's ## Configuration or .env.example`,
      ),
    )
  }
  return result("C9", "pass", `${reads.size} env var(s) read, all documented`)
}

const RUNNERS: Record<CheckId, (ctx: CheckContext) => Promise<CheckResult>> = {
  C1: c1,
  C2: c2,
  C3: c3,
  C4: c4,
  C5: c5,
  C6: c6,
  C7: c7,
  C8: c8,
  C9: c9,
}

export async function runCheck(id: CheckId, ctx: CheckContext): Promise<CheckResult> {
  return RUNNERS[id](ctx)
}

export async function runChecks(ctx: CheckContext): Promise<CheckResult[]> {
  const out: CheckResult[] = []
  for (const id of CHECK_SETS[ctx.set]) out.push(await runCheck(id, ctx))
  return out
}

const MARKS: Record<CheckStatus, string> = { pass: "✓", fail: "✗", warn: "!", skip: "–" }

export function formatResults(results: CheckResult[]): string {
  const lines: string[] = []
  for (const r of results) {
    lines.push(`${MARKS[r.status]} ${r.id} ${r.title}: ${r.summary}`)
    if (r.status !== "pass") for (const d of r.details) lines.push(`    ${d}`)
    for (const e of r.evidence ?? []) lines.push(`    ${e}`)
  }
  const n = (s: CheckStatus) => results.filter((r) => r.status === s).length
  lines.push(`${n("pass")} passed, ${n("fail")} failed, ${n("warn")} warning${n("warn") === 1 ? "" : "s"}`)
  return lines.join("\n")
}
