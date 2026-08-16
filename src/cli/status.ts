import * as fs from "node:fs/promises"
import * as path from "node:path"
import { run } from "./exec.ts"
import { currentApproval, exists, featureDir, parsePlan, parseQa, parseReview, readIfExists } from "./feature.ts"
import { currentBranch } from "./git.ts"

export const STAGES = ["spec", "gate", "implement", "review", "pr", "qa", "done"] as const
export type Stage = (typeof STAGES)[number]

export type PrInfo = { url: string; isDraft: boolean; state: string }

export type FeatureStatus = {
  slug: string
  stage: Stage
  next: string
  /** The approval in force: `<date> at <sha>`. */
  approved?: string
  pr?: PrInfo
  notes: string[]
}

export type StatusDeps = {
  /** The PR for the current branch, null when there is none, undefined when it can't be told (no gh, no auth). */
  pr: (root: string) => Promise<PrInfo | null | undefined>
}

export async function ghPr(root: string): Promise<PrInfo | null | undefined> {
  const r = await run("gh", ["pr", "view", "--json", "url,isDraft,state"], { cwd: root, timeoutMs: 20_000 })
  if (r.code === null) return undefined
  if (r.code !== 0) return /no pull requests? found/i.test(r.stderr) ? null : undefined
  try {
    return JSON.parse(r.stdout) as PrInfo
  } catch {
    return undefined
  }
}

const NEXT: Record<Stage, (slug: string) => string> = {
  spec: () => "write spec.md and plan.md (solodev-plan), asking the user what the code can't answer",
  gate: (s) => `show the gate card; on approval run \`solodev approve ${s}\``,
  implement: (s) =>
    `solodev-code writes each journey's test, then the code; then \`solodev check ${s} --for implement\``,
  review: () => "settle the open blocker/major findings in review.md: a fix round, or the user's decision",
  pr: (s) => `\`solodev check ${s} --for pr\`, then push and open the draft PR`,
  qa: (s) =>
    `solodev-verify for uncovered scenarios (if any); then \`solodev check ${s} --for done\` and mark the PR ready`,
  done: () => "the user reviews and merges the PR",
}

/** `root` is the project, `state` the repo's folder of features (state.ts). */
export async function featureStatus(
  root: string,
  state: string,
  slug: string,
  deps: StatusDeps,
): Promise<FeatureStatus> {
  const dir = featureDir(state, slug)
  const notes: string[] = []
  const done = (stage: Stage, extra: Partial<FeatureStatus> = {}): FeatureStatus => ({
    slug,
    stage,
    next: NEXT[stage](slug),
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

  const pr = await deps.pr(root)
  if (pr === undefined) notes.push("couldn't read the PR (is gh installed and logged in?)")
  if (!pr) return done("pr", { approved, pr: pr ?? undefined })
  if (pr.state === "MERGED") return done("done", { approved, pr, notes: [...notes, "merged"] })
  if (!pr.isDraft) return done("done", { approved, pr })

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
  if (s.pr) lines.push(`  pr: ${s.pr.url}${s.pr.isDraft ? " (draft)" : ""}`)
  for (const n of s.notes) lines.push(`  note: ${n}`)
  lines.push(`  next: ${s.next}`)
  return lines.join("\n")
}
