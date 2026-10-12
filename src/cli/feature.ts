import * as fs from "node:fs/promises"
import * as path from "node:path"
import { parse as parseYaml } from "yaml"

export const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function featureDir(root: string, slug: string): string {
  return path.join(root, "docs", "feats", slug)
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

/** Command names solodev reads from AGENTS.md. */
export const COMMAND_NAMES = ["install", "dev", "build", "test", "test_file", "lint", "typecheck"] as const

/**
 * The `## Commands` list in AGENTS.md: `- <name>: <command>`. The command is the first backticked span, so a note can
 * follow it; `n/a` (or no span after n/a) means the repo has none and maps to null.
 */
export function parseCommands(agents: string): Map<string, string | null> {
  const out = new Map<string, string | null>()
  const section = agents.split(/^## Commands[ \t]*$/m)[1]?.split(/^## /m)[0]
  if (section === undefined) return out
  for (const line of section.split("\n")) {
    const m = line.match(/^\s*[-*]\s+([A-Za-z_/ -]+?):\s*(.*)$/)
    if (!m) continue
    const name = m[1]!.trim().toLowerCase()
    const rest = m[2]!.trim()
    if (/^n\/a\b/i.test(rest)) {
      out.set(name, null)
      continue
    }
    const span = rest.match(/`([^`]+)`/)?.[1]?.trim()
    if (span === undefined) continue
    out.set(name, /^n\/a$/i.test(span) ? null : span)
  }
  return out
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
