import * as path from "node:path"
import { run } from "./exec.ts"
import {
  type Approval,
  currentApproval,
  parsePlan,
  parseProofs,
  parseQa,
  parseReview,
  parseScenarios,
  type Plan,
  readIfExists,
  SEVERITIES,
  STATUSES,
} from "./feature.ts"
import { git, resolveBase, treeHash } from "./git.ts"

export type CheckStatus = "pass" | "fail"
export type CheckResult = {
  id: string
  title: string
  status: CheckStatus
  summary: string
  /** Shown when the check doesn't pass. */
  details: string[]
}

export const CHECK_IDS = ["C1", "C2", "C3", "C4", "C5", "C6"] as const
export type CheckId = (typeof CHECK_IDS)[number]

export const CHECK_SETS = {
  gate: ["C1"],
  implement: ["C1", "C2", "C6"],
  pr: ["C1", "C2", "C3", "C4", "C6"],
  done: ["C1", "C2", "C3", "C4", "C5", "C6"],
} as const satisfies Record<string, readonly CheckId[]>

export type CheckSet = keyof typeof CHECK_SETS

export type CheckContext = {
  /** The project. */
  root: string
  /** The feature folder, outside the project (state.ts). */
  dir: string
  set: CheckSet
  env?: Record<string, string | undefined>
}

const TITLES: Record<CheckId, string> = {
  C1: "scenario coverage",
  C2: "gate held",
  C3: "reports only",
  C4: "review settled",
  C5: "QA verdicts",
  C6: "proof recorded",
}

const result = (id: CheckId, status: CheckStatus, summary: string, details: string[] = []): CheckResult => ({
  id,
  title: TITLES[id],
  status,
  summary,
  details,
})

async function loadPlan(dir: string): Promise<Plan> {
  const raw = await readIfExists(path.join(dir, "spec.md"))
  if (raw === undefined) throw new Error(`spec.md not found in ${dir}`)
  return parsePlan(raw)
}

/** The code without the feature: where the branch forked from the default branch. */
const baseOf = (ctx: CheckContext) => resolveBase(ctx.root, { ...process.env, ...ctx.env })

const NO_BASE = "can't find the base branch — set SOLODEV_BASE"

/**
 * C1. At the gate the journey tests don't exist yet, so `requireTests` is off there. Past it, each scenario a journey
 * claims carries its `@S<n>` tag in that journey's test file, in a test name or a comment beside its assertion.
 */
export async function coverage(root: string, dir: string, requireTests: boolean): Promise<CheckResult> {
  const spec = await readIfExists(path.join(dir, "spec.md"))
  if (spec === undefined) return result("C1", "fail", `spec.md not found in ${dir}`)
  const scenarios = parseScenarios(spec)
  if (!scenarios.length) return result("C1", "fail", "spec.md has no @S<n> scenarios")
  let plan: Plan
  try {
    plan = parsePlan(spec)
  } catch (err) {
    return result("C1", "fail", (err as Error).message)
  }
  const claimed = new Set([...plan.journeys.flatMap((j) => j.scenarios), ...plan.uncovered])
  const details: string[] = []
  const unclaimed = scenarios.filter((s) => !claimed.has(s))
  if (unclaimed.length) details.push(`no journey or uncovered entry claims ${unclaimed.join(", ")}`)
  const unknown = [...claimed].filter((s) => !scenarios.includes(s))
  if (unknown.length) details.push(`the plan names ${unknown.join(", ")}, which spec.md doesn't define`)
  for (const j of plan.journeys) {
    if (!requireTests) continue
    const test = await readIfExists(path.join(root, j.test))
    if (test === undefined) {
      details.push(`${j.id}: test file ${j.test} does not exist`)
      continue
    }
    const untagged = j.scenarios.filter((s) => !new RegExp(`@${s}(?!\\d)`).test(test))
    if (untagged.length) {
      details.push(
        `${j.id}: ${j.test} has no ${untagged.map((s) => `@${s}`).join(", ")}; tag the test or assertion that proves each`,
      )
    }
  }
  if (details.length) return result("C1", "fail", details[0]!, details.slice(1))
  const tests = plan.journeys.length
  const uncovered = plan.uncovered.length ? `, ${plan.uncovered.length} left to QA` : ""
  // Before the gate is the cheap moment to split: a feature this size sends every review down the parallel path.
  const large =
    !requireTests && (scenarios.length > MAX_SCENARIOS || tests > MAX_JOURNEYS)
      ? ` — large for one feature (over ${MAX_SCENARIOS} scenarios or ${MAX_JOURNEYS} journeys): consider splitting it with /solo-epic`
      : ""
  return result(
    "C1",
    "pass",
    `${scenarios.length} scenarios, ${tests} journey test${tests === 1 ? "" : "s"}${uncovered}${large}`,
  )
}

const MAX_SCENARIOS = 12
const MAX_JOURNEYS = 3

const c1 = (ctx: CheckContext) => coverage(ctx.root, ctx.dir, ctx.set !== "gate")

async function c2(ctx: CheckContext): Promise<CheckResult> {
  const { approval, approvals, matches } = await currentApproval(ctx.dir)
  if (!approval) return result("C2", "fail", "not approved — run solodev approve at the spec gate")
  if (!matches) return result("C2", "fail", "spec.md changed since approval — show the user and approve again")
  const base = await baseOf(ctx)
  if (!base) return result("C2", "fail", NO_BASE)
  // The gate is the earliest approval still in this branch: no code before it. Later ones re-agree an edited spec.
  let gate: Approval | undefined
  for (const a of approvals) {
    if ((await run("git", ["merge-base", "--is-ancestor", a.at, "HEAD"], { cwd: ctx.root })).code === 0) {
      gate = a
      break
    }
  }
  if (!gate) {
    return result(
      "C2",
      "fail",
      `approved at ${approval.at}, which isn't in this branch — it was rewritten; approve again`,
    )
  }
  const early = (await git(ctx.root, ["log", "--format=%h %s", `${base}..${gate.at}`])).split("\n").filter(Boolean)
  if (early.length) {
    return result("C2", "fail", `${early.length} commit(s) before the approval`, early.slice(0, 20))
  }
  return result("C2", "pass", `approved ${approval.date} at ${approval.at.slice(0, 7)}, no code before the gate`)
}

async function c3(ctx: CheckContext): Promise<CheckResult> {
  // Reports live in the feature folder, outside the project, so any tracked change left behind is a stray edit.
  const dirty = (await git(ctx.root, ["status", "--porcelain", "--untracked-files=no"])).split("\n").filter(Boolean)
  if (dirty.length) {
    return result(
      "C3",
      "fail",
      "uncommitted changes in the project",
      dirty.map((l) => l.slice(3).trim()),
    )
  }
  return result("C3", "pass", "no uncommitted changes in the project")
}

async function c4(ctx: CheckContext): Promise<CheckResult> {
  const raw = await readIfExists(path.join(ctx.dir, "review.md"))
  if (raw === undefined) return result("C4", "fail", "no review.md — run solo-review")
  const findings = parseReview(raw)
  const bad = findings.filter(
    (f) =>
      !(SEVERITIES as readonly string[]).includes(f.severity) || !(STATUSES as readonly string[]).includes(f.status),
  )
  if (bad.length) {
    return result(
      "C4",
      "fail",
      "review.md has rows with an unknown severity or status",
      bad.map((f) => `${f.id}: severity "${f.severity}", status "${f.status}"`),
    )
  }
  const open = findings.filter((f) => f.status === "open" && (f.severity === "blocker" || f.severity === "major"))
  if (open.length) {
    return result(
      "C4",
      "fail",
      `${open.length} open blocker/major`,
      open.map((f) => `${f.id} ${f.severity} ${f.location} ${f.summary}`),
    )
  }
  return result(
    "C4",
    "pass",
    `${findings.length} finding${findings.length === 1 ? "" : "s"}, none open at blocker/major`,
  )
}

/** `waived` is the user's call on a scenario nobody could automate; the finish card lists it. */
const PASSING_VERDICTS = ["pass", "waived"]

async function c5(ctx: CheckContext): Promise<CheckResult> {
  let plan: Plan
  try {
    plan = await loadPlan(ctx.dir)
  } catch (err) {
    return result("C5", "fail", (err as Error).message)
  }
  if (!plan.uncovered.length) return result("C5", "pass", "every scenario has a journey test")
  const verdicts = parseQa((await readIfExists(path.join(ctx.dir, "review.md"))) ?? "")
  if (!verdicts.size) {
    return result("C5", "fail", `no QA verdicts in review.md for ${plan.uncovered.join(", ")} — run solo-verify`)
  }
  const details: string[] = []
  for (const s of plan.uncovered) {
    const v = verdicts.get(s)
    if (!v) details.push(`${s} has no QA verdict in review.md`)
    else if (v.verdict === "manual") details.push(`${s} needs a person: ask the user to check it or waive it`)
    else if (!PASSING_VERDICTS.includes(v.verdict)) details.push(`${s} ${v.verdict}: ${v.evidence}`)
  }
  if (details.length) return result("C5", "fail", details[0]!, details.slice(1))
  return result("C5", "pass", `${plan.uncovered.length} uncovered scenario(s) verified`)
}

/**
 * C6. The coder ran each journey's command and recorded it with `solodev proof`: a red before the code, on another
 * tree than the green, then a green on the tree as it stands now. The exit codes are the coder's word; the tree hash and the order are not.
 */
async function c6(ctx: CheckContext): Promise<CheckResult> {
  let plan: Plan
  try {
    plan = await loadPlan(ctx.dir)
  } catch (err) {
    return result("C6", "fail", (err as Error).message)
  }
  const proofs = parseProofs((await readIfExists(path.join(ctx.dir, "progress.md"))) ?? "")
  const tree = await treeHash(ctx.root)
  const details: string[] = []
  for (const j of plan.journeys) {
    const own = proofs.filter((p) => p.journey === j.id)
    const green = own.findLastIndex((p) => p.phase === "green")
    if (green === -1) {
      details.push(`${j.id} has no green record — run its command, then \`solodev proof <slug> ${j.id} green\``)
    } else if (own[green]!.tree !== tree) {
      details.push(`${j.id}'s green is stale: the code changed since — run its command and record green again`)
    }
    const reds = (green === -1 ? own : own.slice(0, green)).filter((p) => p.phase === "red")
    if (!reds.length) {
      details.push(`${j.id} has no red record before its green — its test was never seen failing without the code`)
    } else if (green !== -1 && reds.every((p) => p.tree === own[green]!.tree)) {
      details.push(
        `${j.id}'s red was recorded on the same tree as its green — a red counts only from before the code: set the code aside, run the test, record red, restore it, record green`,
      )
    }
  }
  if (details.length) return result("C6", "fail", details[0]!, details.slice(1))
  const n = plan.journeys.length
  return result("C6", "pass", `${n} journey${n === 1 ? "" : "s"} seen red, then green on this tree`)
}

const RUNNERS: Record<CheckId, (ctx: CheckContext) => Promise<CheckResult>> = {
  C1: c1,
  C2: c2,
  C3: c3,
  C4: c4,
  C5: c5,
  C6: c6,
}

export async function runCheck(id: CheckId, ctx: CheckContext): Promise<CheckResult> {
  return RUNNERS[id](ctx)
}

export async function runChecks(ctx: CheckContext): Promise<CheckResult[]> {
  const out: CheckResult[] = []
  for (const id of CHECK_SETS[ctx.set]) out.push(await runCheck(id, ctx))
  return out
}

const MARKS: Record<CheckStatus, string> = { pass: "✓", fail: "✗" }

export function formatResults(results: CheckResult[]): string {
  const lines: string[] = []
  for (const r of results) {
    lines.push(`${MARKS[r.status]} ${r.id} ${r.title}: ${r.summary}`)
    if (r.status !== "pass") for (const d of r.details) lines.push(`    ${d}`)
  }
  const n = (s: CheckStatus) => results.filter((r) => r.status === s).length
  lines.push(`${n("pass")} passed, ${n("fail")} failed`)
  return lines.join("\n")
}
