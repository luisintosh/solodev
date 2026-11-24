import * as fs from "node:fs/promises"
import * as path from "node:path"
import { coverage, featureBase, NO_BASE } from "./checks.ts"
import { type Approval, approvalLine, parseApprovals, readIfExists, specHash } from "./feature.ts"
import { git } from "./git.ts"

export type ApproveOptions = { root: string; dir: string; date?: string; env?: Record<string, string | undefined> }

/**
 * Records the spec gate: appends an approval line to the feature's progress.md with a hash of spec.md, the project's
 * HEAD and the count of the branch's commits past its base. Refuses when the plan doesn't cover the spec (C1), when
 * code is staged, or, at the first approval, when the branch already holds commits: nothing may be committed to the
 * project before the gate. Commits nothing.
 */
export async function approve(opts: ApproveOptions): Promise<Approval> {
  const covered = await coverage(opts.root, opts.dir, false)
  if (covered.status !== "pass") {
    throw new Error([`can't approve: ${covered.summary}`, ...covered.details].join("\n  "))
  }
  const staged = (await git(opts.root, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean)
  if (staged.length) throw new Error(`can't approve: staged files: ${staged.join(", ")}`)
  const base = await featureBase(opts.root, opts.dir, opts.env)
  if (!base) throw new Error(`can't approve: ${NO_BASE}`)
  const early = (await git(opts.root, ["log", "--format=%h %s", `${base.sha}..HEAD`])).split("\n").filter(Boolean)
  const progressFile = path.join(opts.dir, "progress.md")
  const progress = (await readIfExists(progressFile)) ?? ""
  // A later approval re-agrees an edited spec, once code exists.
  if (early.length && !parseApprovals(progress).length) {
    throw new Error(
      [
        `can't approve: ${early.length} commit(s) on the branch past base ${base.ref}: code before the gate, or the wrong base — log the branch the PR targets as \`- base <ref>\` in progress.md`,
        ...early.slice(0, 20),
      ].join("\n  "),
    )
  }
  const approval: Approval = {
    date: opts.date ?? new Date().toISOString().slice(0, 10),
    spec: specHash(await fs.readFile(path.join(opts.dir, "spec.md"), "utf8")),
    at: (await git(opts.root, ["rev-parse", "--short=12", "HEAD"])).trim(),
    early: early.length,
  }
  const sep = progress === "" || progress.endsWith("\n") ? "" : "\n"
  await fs.writeFile(progressFile, `${progress}${sep}${approvalLine(approval)}\n`)
  return approval
}
