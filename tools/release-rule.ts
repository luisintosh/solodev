/**
 * The skills/ rule: skills/ at the repo root is what `npx skills add` installs, and only `pnpm run release` writes it.
 * Every commit that touches skills/ must be a `release vX.Y.Z` commit that touches nothing else.
 */
export const RELEASE_SUBJECT = /^release v\d+\.\d+\.\d+$/

export interface Commit {
  sha: string
  subject: string
  files: string[]
}

/**
 * Problems with the commits that touch skills/ (newest first, as `git log` lists them), one message per offending commit.
 * The rule starts at the oldest release commit: the harness's first versions kept unrelated files in skills/.
 */
export function skillsRuleViolations(commits: Commit[]): string[] {
  const out: string[] = []
  const oldestRelease = commits.findLastIndex((c) => RELEASE_SUBJECT.test(c.subject))
  for (const c of commits.slice(0, oldestRelease + 1)) {
    if (!c.files.some((f) => f.startsWith("skills/"))) continue
    const short = c.sha.slice(0, 7)
    if (!RELEASE_SUBJECT.test(c.subject)) {
      out.push(`${short} "${c.subject}" changes skills/ — only \`pnpm run release\` may write it`)
      continue
    }
    const other = c.files.filter((f) => !f.startsWith("skills/"))
    if (other.length)
      out.push(`${short} "${c.subject}" also changes ${other.join(", ")} — a release touches only skills/`)
  }
  return out
}

/** Paths that differ between two file listings (relative path → content). */
export function treeDiff(have: Map<string, string>, want: Map<string, string>): string[] {
  const out: string[] = []
  for (const [p, content] of want) if (have.get(p) !== content) out.push(p)
  for (const p of have.keys()) if (!want.has(p)) out.push(p)
  return out.sort()
}
