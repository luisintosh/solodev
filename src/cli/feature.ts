import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { parse as parseYaml } from "yaml"

export const SLUG = /^[a-z0-9][a-z0-9-]*$/

/** A feature's folder under the repo's state dir (see state.ts); nothing in it is committed. */
export function featureDir(state: string, slug: string): string {
  return path.join(state, slug)
}

/** What the user approved: spec.md and plan.md together, so an edit to either reopens the gate. */
export function specHash(spec: string, plan: string): string {
  return createHash("sha256").update(spec).update("\0").update(plan).digest("hex").slice(0, 12)
}

export type Approval = { date: string; spec: string; at: string }

const APPROVAL = /^- approved (\S+) · spec ([0-9a-f]+) · at ([0-9a-f]+)\s*$/gm

/** The line `solodev approve` appends to progress.md. */
export function approvalLine(a: Approval): string {
  return `- approved ${a.date} · spec ${a.spec} · at ${a.at}`
}

/** Approval lines in progress.md, oldest first; the last one is in force. */
export function parseApprovals(progress: string): Approval[] {
  return [...progress.matchAll(APPROVAL)].map((m) => ({ date: m[1]!, spec: m[2]!, at: m[3]! }))
}

export type PrEvent = { url: string; state: "draft" | "ready" }

const PR_EVENT = /^- pr (\S+) · (draft|ready)\s*$/gm

/** The PR lines the commander appends to progress.md (`- pr <url> · draft|ready`), oldest first. */
export function parsePrEvents(progress: string): PrEvent[] {
  return [...progress.matchAll(PR_EVENT)].map((m) => ({ url: m[1]!, state: m[2] as PrEvent["state"] }))
}

/** The last `- tools: …` line in progress.md: the forge, tracker and commands the run settled on. */
export function parseTools(progress: string): string | undefined {
  return [...progress.matchAll(/^- tools: (.+?)\s*$/gm)].at(-1)?.[1]
}

/**
 * The approval in force, whether spec.md and plan.md still match it, and every approval oldest first. A later one
 * re-agrees an edited spec, so code may already exist before it.
 */
export async function currentApproval(
  dir: string,
): Promise<{ approval?: Approval; approvals: Approval[]; matches: boolean }> {
  const [spec, plan, progress] = await Promise.all(
    ["spec.md", "plan.md", "progress.md"].map((f) => readIfExists(path.join(dir, f))),
  )
  const approvals = parseApprovals(progress ?? "")
  const approval = approvals.at(-1)
  const matches =
    approval !== undefined && spec !== undefined && plan !== undefined && specHash(spec, plan) === approval.spec
  return { approval, approvals, matches }
}

export async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}

/** `@S<n>` ids in order of first appearance, as `S<n>`. */
export function parseScenarios(spec: string): string[] {
  return [...new Set([...spec.matchAll(/@S(\d+)\b/g)].map((m) => `S${m[1]}`))]
}

export type Journey = { id: string; scenarios: string[]; test: string; command: string }
export type Plan = { journeys: Journey[]; uncovered: string[] }

function scenarioId(value: unknown): string {
  return String(value).trim().replace(/^@/, "")
}

/** The fenced YAML block in plan.md whose first key is `journeys:`. Throws with a message an agent can act on. */
export function parsePlan(plan: string): Plan {
  for (const m of plan.matchAll(/^```(?:ya?ml)?[ \t]*\n([\s\S]*?)^```/gm)) {
    const body = m[1]!
    if (!/^journeys:/m.test(body.trimStart().split("\n")[0] ?? "")) continue
    let parsed: unknown
    try {
      parsed = parseYaml(body)
    } catch (err) {
      throw new Error(`plan.md: the journeys block is not valid YAML — ${(err as Error).message.split("\n")[0]}`)
    }
    const doc = parsed as { journeys?: unknown; uncovered?: unknown }
    if (!Array.isArray(doc.journeys)) throw new Error("plan.md: `journeys:` must be a list")
    const journeys = doc.journeys.map((raw, i) => {
      const j = (raw ?? {}) as Record<string, unknown>
      const missing = ["id", "scenarios", "test", "command"].filter((k) => j[k] === undefined || j[k] === "")
      if (missing.length) throw new Error(`plan.md: journey ${i + 1} is missing ${missing.join(", ")}`)
      if (!Array.isArray(j.scenarios)) throw new Error(`plan.md: journey ${j.id} scenarios must be a list`)
      return {
        id: String(j.id),
        scenarios: j.scenarios.map(scenarioId),
        test: String(j.test),
        command: String(j.command),
      }
    })
    const uncovered = Array.isArray(doc.uncovered) ? doc.uncovered.map(scenarioId) : []
    return { journeys, uncovered }
  }
  throw new Error("plan.md: no fenced YAML block starting with `journeys:`")
}

export const SEVERITIES = ["blocker", "major", "minor"] as const
export const STATUSES = ["open", "fixed", "rebutted", "deferred", "dropped"] as const

export type Finding = { id: string; severity: string; location: string; status: string; summary: string }

/** Rows of every markdown table whose header names the given columns, as column → cell maps. */
function tableRows(md: string, required: string[]): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  let header: string[] | undefined
  for (const line of md.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("|")) {
      header = undefined
      continue
    }
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim())
    if (!header) {
      const lower = cells.map((c) => c.toLowerCase())
      if (required.every((r) => lower.includes(r))) header = lower
      continue
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])))
  }
  return rows
}

/** review.md: a table `| id | severity | location | status | finding |`. */
export function parseReview(md: string): Finding[] {
  return tableRows(md, ["id", "severity", "status"]).map((r) => ({
    id: r.id ?? "",
    severity: (r.severity ?? "").toLowerCase(),
    location: r.location ?? "",
    status: (r.status ?? "").toLowerCase(),
    summary: r.finding ?? "",
  }))
}

export type Verdict = { verdict: string; evidence: string }

/** qa.md: a table `| scenario | verdict | evidence |`, verdict pass or fail. */
export function parseQa(md: string): Map<string, Verdict> {
  const out = new Map<string, Verdict>()
  for (const r of tableRows(md, ["scenario", "verdict"])) {
    out.set(scenarioId(r.scenario), { verdict: (r.verdict ?? "").toLowerCase(), evidence: r.evidence ?? "" })
  }
  return out
}
