import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { run, shell, tail } from "./exec.ts"
import {
  exists,
  featureDir,
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
import { commitsWithPaths, featurePath, firstAdded, gateCommits, git, resolveBase } from "./git.ts"

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

export const CHECK_IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"] as const
export type CheckId = (typeof CHECK_IDS)[number]

export const CHECK_SETS = {
  implement: ["C1", "C2", "C3", "C4"],
  pr: ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
  done: [...CHECK_IDS],
} as const satisfies Record<string, readonly CheckId[]>

export type CheckSet = keyof typeof CHECK_SETS

export type CheckContext = {
  root: string
  slug: string
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
  C5: "gate before code",
  C6: "reports only",
  C7: "review settled",
  C8: "QA verdicts",
}

const result = (id: CheckId, status: CheckStatus, summary: string, details: string[] = []): CheckResult => ({
  id,
  title: TITLES[id],
  status,
  summary,
  details,
})

async function loadPlan(root: string, slug: string): Promise<Plan> {
  const raw = await readIfExists(path.join(featureDir(root, slug), "plan.md"))
  if (raw === undefined) throw new Error(`docs/feats/${slug}/plan.md not found`)
  return parsePlan(raw)
}

async function c1(ctx: CheckContext): Promise<CheckResult> {
  const agents = await readIfExists(path.join(ctx.root, "AGENTS.md"))
  if (agents === undefined) return result("C1", "fail", "AGENTS.md not found — run /arise-scout")
  const commands = parseCommands(agents)
  const names = ctx.set === "implement" ? ["typecheck", "lint"] : ["typecheck", "lint", "test", "build"]
  const parts: string[] = []
  const details: string[] = []
  let failed = false
  for (const name of names) {
    if (!commands.has(name)) {
      failed = true
      parts.push(`${name} missing`)
      details.push(`AGENTS.md ## Commands has no \`- ${name}:\` line; write n/a when the repo has none`)
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
export async function coverage(root: string, slug: string, requireTests: boolean): Promise<CheckResult> {
  const ctx = { root, slug }
  const spec = await readIfExists(path.join(featureDir(ctx.root, ctx.slug), "spec.md"))
  if (spec === undefined) return result("C2", "fail", `docs/feats/${ctx.slug}/spec.md not found`)
  const scenarios = parseScenarios(spec)
  if (!scenarios.length) return result("C2", "fail", "spec.md has no @S<n> scenarios")
  let plan: Plan
  try {
    plan = await loadPlan(ctx.root, ctx.slug)
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
    if (requireTests && !(await exists(path.join(ctx.root, j.test)))) {
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

const c2 = (ctx: CheckContext) => coverage(ctx.root, ctx.slug, true)

/** Dependency folders a temporary worktree borrows from the checkout instead of reinstalling. */
const DEPENDENCY_DIRS = ["node_modules", ".venv", "venv", "vendor"]

async function c3(ctx: CheckContext): Promise<CheckResult> {
  const gate = (await gateCommits(ctx.root, ctx.slug))[0]
  if (!gate) return result("C3", "fail", "no approval commit — run solodev approve at the spec gate")
  let plan: Plan
  try {
    plan = await loadPlan(ctx.root, ctx.slug)
  } catch (err) {
    return result("C3", "fail", (err as Error).message)
  }
  if (!plan.journeys.length) return result("C3", "pass", "no journey tests to prove")
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "solodev-c3-"))
  const worktree = path.join(tmp, "gate")
  const details: string[] = []
  const evidence: string[] = []
  const parts: string[] = []
  let failed = false
  try {
    await git(ctx.root, ["worktree", "add", "--detach", "--quiet", worktree, gate.sha])
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
    for (const j of plan.journeys) {
      const before = await shell(j.command, worktree, ctx.timeoutMs)
      const after = await shell(j.command, ctx.root, ctx.timeoutMs)
      if (before.code === 0) {
        failed = true
        parts.push(`${j.id} passes at gate`)
        details.push(`${j.id}: \`${j.command}\` passes against the gate commit's code, so it doesn't prove the change`)
      } else if (after.code !== 0) {
        failed = true
        parts.push(`${j.id} FAILS now`)
        details.push(`${j.id}: \`${j.command}\` fails at HEAD:`, ...tail(after).map((l) => `  ${l}`))
      } else {
        parts.push(`${j.id} red→green`)
        // The reviewer judges whether the test failed for the right reason (missing behavior, not a broken test).
        evidence.push(`${j.id} failed at the gate commit with:`, ...tail(before, 8).map((l) => `  ${l}`))
      }
    }
  } catch (err) {
    failed = true
    details.unshift((err as Error).message)
    parts.push("could not run")
  } finally {
    await run("git", ["worktree", "remove", "--force", worktree], { cwd: ctx.root })
    await fs.rm(tmp, { recursive: true, force: true })
    await run("git", ["worktree", "prune"], { cwd: ctx.root })
  }
  return { ...result("C3", failed ? "fail" : "pass", parts.join(" · "), details), evidence }
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
    plan = await loadPlan(ctx.root, ctx.slug)
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

  // Every other test the feature touched: against the gate commit, where it already protected existing behavior.
  const gate = (await gateCommits(ctx.root, ctx.slug))[0]
  if (gate) {
    const changed = (await git(ctx.root, ["diff", "--name-only", gate.sha])).split("\n").filter(Boolean)
    for (const file of changed) {
      if (journeyTests.has(file) || file.startsWith(featurePath(ctx.slug)) || !TEST_FILE.test(file)) continue
      const before = await run("git", ["show", `${gate.sha}:${file}`], { cwd: ctx.root })
      if (before.code === 0) await compare(file, before.stdout, gate.sha)
    }
  }

  if (deleted) return result("C4", "fail", details[0]!, details.slice(1))
  if (flagged) return result("C4", "warn", "a test may have been weakened", details)
  if (!checked) return result("C4", "skip", "no committed test to compare yet")
  return result("C4", "pass", `${checked} test${checked === 1 ? "" : "s"} unchanged in strength`)
}

async function c5(ctx: CheckContext): Promise<CheckResult> {
  const gate = (await gateCommits(ctx.root, ctx.slug))[0]
  if (!gate) return result("C5", "fail", "no approval commit — run solodev approve at the spec gate")
  const base = await resolveBase(ctx.root, { ...process.env, ...ctx.env })
  if (!base) return result("C5", "fail", "can't find the base branch — set SOLODEV_BASE")
  const outside = []
  for (const c of await commitsWithPaths(ctx.root, `${base}..${gate.sha}`)) {
    for (const p of c.paths) if (!p.startsWith(featurePath(ctx.slug))) outside.push(`${c.sha.slice(0, 7)} ${p}`)
  }
  if (outside.length) {
    return result("C5", "fail", `${outside.length} path(s) changed before the gate commit`, outside.slice(0, 20))
  }
  return result("C5", "pass", `nothing outside docs/feats/${ctx.slug}/ before ${gate.sha.slice(0, 7)}`)
}

const REPORTS = ["review.md", "qa.md"]

async function c6(ctx: CheckContext): Promise<CheckResult> {
  const reports = REPORTS.map((f) => `${featurePath(ctx.slug)}${f}`)
  const base = await resolveBase(ctx.root, { ...process.env, ...ctx.env })
  if (!base) return result("C6", "fail", "can't find the base branch — set SOLODEV_BASE")
  const details: string[] = []
  for (const c of await commitsWithPaths(ctx.root, `${base}..HEAD`)) {
    if (!c.paths.some((p) => reports.includes(p))) continue
    const extra = c.paths.filter((p) => !reports.includes(p))
    if (extra.length) details.push(`${c.sha.slice(0, 7)} changes ${extra.join(", ")} beside its report`)
  }
  const status = await git(ctx.root, ["status", "--porcelain", "--untracked-files=all"])
  const dirty = status
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
  if (dirty.some((p) => reports.includes(p))) {
    const extra = dirty.filter((p) => !reports.includes(p))
    if (extra.length) details.push(`uncommitted changes beside a report: ${extra.join(", ")}`)
  }
  if (details.length) return result("C6", "fail", "a reviewer or verifier changed more than its report", details)
  return result("C6", "pass", "report commits touch only review.md or qa.md")
}

async function c7(ctx: CheckContext): Promise<CheckResult> {
  const raw = await readIfExists(path.join(featureDir(ctx.root, ctx.slug), "review.md"))
  if (raw === undefined) return result("C7", "fail", "no review.md — run arise-reviewer")
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
    plan = await loadPlan(ctx.root, ctx.slug)
  } catch (err) {
    return result("C8", "fail", (err as Error).message)
  }
  if (!plan.uncovered.length) return result("C8", "pass", "every scenario has a journey test")
  const raw = await readIfExists(path.join(featureDir(ctx.root, ctx.slug), "qa.md"))
  if (raw === undefined) return result("C8", "fail", `no qa.md for ${plan.uncovered.join(", ")} — run arise-verifier`)
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

const RUNNERS: Record<CheckId, (ctx: CheckContext) => Promise<CheckResult>> = {
  C1: c1,
  C2: c2,
  C3: c3,
  C4: c4,
  C5: c5,
  C6: c6,
  C7: c7,
  C8: c8,
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
