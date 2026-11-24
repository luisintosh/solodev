import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  currentApproval,
  exists,
  failedQa,
  featureDir,
  type PrEvent,
  parsePlan,
  parsePrEvents,
  parseQa,
  parseReview,
  parseTools,
  readIfExists,
} from "./feature.ts"
import { featureBase } from "./checks.ts"
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
  /** The base the checks use, `<ref> @ <sha>`: where the branch forked from the branch its PR targets. */
  base?: string
  notes: string[]
}

const NEXT: Record<Stage, (slug: string) => string> = {
  spec: () => "write spec.md with its plan (solo-plan), asking the user what the code can't answer",
  gate: (s) => `\`solodev check ${s} --for gate\`, then show the gate card; on approval run \`solodev approve ${s}\``,
  implement: (s) =>
    `solo-code writes the journey tests and the code; then \`solodev check ${s} --for implement\`; once progress.md logs it passed, code review`,
  review: () =>
    "settle the open blocker/major findings and failed QA verdicts in review.md: a fix round, or the user's decision",
  pr: (s) =>
    `\`solodev check ${s} --for pr\`, then push, open the draft PR and log \`- pr <url> · draft\` in progress.md`,
  qa: (s) =>
    `post the QA comment and settle any manual verdict (if the plan has uncovered scenarios); then \`solodev check ${s} --for done\`, mark the PR ready and log \`- pr <url> · ready\``,
  done: () => "the user reviews and merges the PR",
}

/**
 * `state` is the repo's folder of features (state.ts). Reads the feature folder; given the project's `root`, also
 * resolves the base from git.
 */
export async function featureStatus(state: string, slug: string, root?: string): Promise<FeatureStatus> {
  const dir = featureDir(state, slug)
  const notes: string[] = []
  const progress = (await readIfExists(path.join(dir, "progress.md"))) ?? ""
  const tools = parseTools(progress)
  let base: string | undefined
  if (root) {
    try {
      const b = await featureBase(root, dir)
      if (b) base = `${b.ref} @ ${b.sha.slice(0, 7)}`
      else notes.push("can't find the base branch — log `- base <ref>` in progress.md")
    } catch (err) {
      notes.push((err as Error).message)
    }
  }
  const done = (stage: Stage, extra: Partial<FeatureStatus> = {}): FeatureStatus => ({
    slug,
    stage,
    next: NEXT[stage](slug),
    ...(tools ? { tools } : {}),
    ...(base ? { base } : {}),
    notes,
    ...extra,
  })

  const spec = await readIfExists(path.join(dir, "spec.md"))
  if (spec === undefined || !/^journeys:/m.test(spec)) return done("spec")
  const { approval, matches } = await currentApproval(dir)
  if (!approval) return done("gate")
  if (!matches) {
    notes.push("spec.md changed since approval")
    return done("gate")
  }

  const approved = `${approval.date} at ${approval.at.slice(0, 7)}`
  const review = await readIfExists(path.join(dir, "review.md"))
  if (review === undefined) return done("implement", { approved })
  const open = parseReview(review).filter(
    (f) => f.status === "open" && (f.severity === "blocker" || f.severity === "major"),
  )
  const failed = failedQa(review)
  if (open.length) notes.push(`open: ${open.map((f) => f.id).join(", ")}`)
  if (failed.length) notes.push(`QA failed: ${failed.join(", ")}`)
  if (open.length || failed.length) return done("review", { approved })

  const pr = parsePrEvents(progress).at(-1)
  if (!pr) return done("pr", { approved })
  if (pr.state === "ready") return done("done", { approved, pr })

  try {
    const uncovered = parsePlan(spec).uncovered
    if (uncovered.length) {
      const verdicts = parseQa(review)
      const missing = uncovered.filter((s) => !verdicts.has(s))
      if (missing.length) notes.push(`no QA verdict yet: ${missing.join(", ")}`)
    }
  } catch (err) {
    notes.push((err as Error).message)
  }
  return done("qa", { approved, pr })
}

/** Where /solo-epic keeps roadmap drafts, beside the feature folders; not a feature. */
export const ROADMAPS_DIR = "roadmaps"

/** Where a standalone /solo-review keeps its reports, beside the feature folders; not a feature. */
export const REVIEWS_DIR = "reviews"
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
    if (e === ROADMAPS_DIR || e === REVIEWS_DIR) continue
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
  if (s.base) lines.push(`  base: ${s.base}`)
  if (s.tools) lines.push(`  tools: ${s.tools}`)
  for (const n of s.notes) lines.push(`  note: ${n}`)
  lines.push(`  next: ${s.next}`)
  return lines.join("\n")
}
