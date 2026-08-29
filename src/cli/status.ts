import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  currentApproval,
  exists,
  featureDir,
  type PrEvent,
  parsePlan,
  parsePrEvents,
  parseQa,
  parseReview,
  parseTools,
  readIfExists,
} from "./feature.ts"
import { currentBranch } from "./git.ts"

export const STAGES = ["spec", "gate", "implement", "review", "pr", "qa", "done"] as const
export type Stage = (typeof STAGES)[number]

export type FeatureStatus = {
  slug: string
  stage: Stage
  next: string
  /** The approval in force: `<date> at <sha>`. */
  approved?: string
  /** The PR from progress.md's last `- pr` line. */
  pr?: PrEvent
  /** progress.md's `- tools:` line. */
  tools?: string
  notes: string[]
}

const NEXT: Record<Stage, (slug: string) => string> = {
  spec: () => "write spec.md and plan.md (solodev-plan), asking the user what the code can't answer",
  gate: (s) => `show the gate card; on approval run \`solodev approve ${s}\``,
  implement: (s) => `solodev-code writes the journey tests and the code; then \`solodev check ${s} --for implement\``,
  review: () => "settle the open blocker/major findings in review.md: a fix round, or the user's decision",
  pr: (s) =>
    `\`solodev check ${s} --for pr\`, then push, open the draft PR and log \`- pr <url> · draft\` in progress.md`,
  qa: (s) =>
    `solodev-verify for uncovered scenarios (if any); then \`solodev check ${s} --for done\`, mark the PR ready and log \`- pr <url> · ready\``,
  done: () => "the user reviews and merges the PR",
}

/** `state` is the repo's folder of features (state.ts). Reads only the feature folder. */
export async function featureStatus(state: string, slug: string): Promise<FeatureStatus> {
  const dir = featureDir(state, slug)
  const notes: string[] = []
  const progress = (await readIfExists(path.join(dir, "progress.md"))) ?? ""
  const tools = parseTools(progress)
  const done = (stage: Stage, extra: Partial<FeatureStatus> = {}): FeatureStatus => ({
    slug,
    stage,
    next: NEXT[stage](slug),
    ...(tools ? { tools } : {}),
    notes,
    ...extra,
  })

  const plan = await readIfExists(path.join(dir, "plan.md"))
  if (plan === undefined || !(await exists(path.join(dir, "spec.md")))) return done("spec")
  const { approval, matches } = await currentApproval(dir)
  if (!approval) return done("gate")
  if (!matches) {
    notes.push("spec.md or plan.md changed since approval")
    return done("gate")
  }

  const approved = `${approval.date} at ${approval.at.slice(0, 7)}`
  const review = await readIfExists(path.join(dir, "review.md"))
  if (review === undefined) return done("implement", { approved })
  const open = parseReview(review).filter(
    (f) => f.status === "open" && (f.severity === "blocker" || f.severity === "major"),
  )
  if (open.length) {
    notes.push(`open: ${open.map((f) => f.id).join(", ")}`)
    return done("review", { approved })
  }

  const pr = parsePrEvents(progress).at(-1)
  if (!pr) return done("pr", { approved })
  if (pr.state === "ready") return done("done", { approved, pr })

  try {
    const uncovered = parsePlan(plan).uncovered
    if (uncovered.length) {
      const verdicts = parseQa((await readIfExists(path.join(dir, "qa.md"))) ?? "")
      const missing = uncovered.filter((s) => !verdicts.has(s))
      if (missing.length) notes.push(`no QA verdict yet: ${missing.join(", ")}`)
    }
  } catch (err) {
    notes.push((err as Error).message)
  }
  return done("qa", { approved, pr })
}

/** Where /solodev-roadmap keeps roadmap drafts, beside the feature folders; not a feature. */
export const ROADMAPS_DIR = "roadmaps"

/** Feature slugs in the repo's state folder, newest directory first. */
export async function listFeatures(state: string): Promise<string[]> {
  const base = state
  let entries: string[]
  try {
    entries = await fs.readdir(base)
  } catch {
    return []
  }
  const dirs: { slug: string; mtime: number }[] = []
  for (const e of entries) {
    if (e === ROADMAPS_DIR) continue
    const st = await fs.stat(path.join(base, e)).catch(() => undefined)
    if (st?.isDirectory()) dirs.push({ slug: e, mtime: st.mtimeMs })
  }
  return dirs.sort((a, b) => b.mtime - a.mtime).map((d) => d.slug)
}

/** The slug the current branch names (`feat/<slug>`), when that feature exists. */
export async function branchFeature(root: string, state: string): Promise<string | undefined> {
  const branch = await currentBranch(root)
  const slug = branch.match(/^feat\/(.+)$/)?.[1]
  if (slug && (await exists(featureDir(state, slug)))) return slug
  return undefined
}

export function formatStatus(s: FeatureStatus): string {
  const lines = [`${s.slug}: ${s.stage}`]
  if (s.approved) lines.push(`  approved: ${s.approved}`)
  if (s.pr) lines.push(`  pr: ${s.pr.url}${s.pr.state === "draft" ? " (draft)" : ""}`)
  if (s.tools) lines.push(`  tools: ${s.tools}`)
  for (const n of s.notes) lines.push(`  note: ${n}`)
  lines.push(`  next: ${s.next}`)
  return lines.join("\n")
}
