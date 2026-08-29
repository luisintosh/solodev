import * as fs from "node:fs/promises"
import * as path from "node:path"
import { coverage } from "./checks.ts"
import { type Approval, approvalLine, readIfExists, specHash } from "./feature.ts"
import { git } from "./git.ts"

export type ApproveOptions = { root: string; dir: string; date?: string }

/**
 * Records the spec gate: appends an approval line to the feature's progress.md with a hash of spec.md + plan.md and
 * the project's HEAD. Refuses when the plan doesn't cover the spec (C1) or when code is staged, since nothing may be
 * committed to the project before the gate. Commits nothing.
 */
export async function approve(opts: ApproveOptions): Promise<Approval> {
  const covered = await coverage(opts.root, opts.dir, false)
  if (covered.status !== "pass") {
    throw new Error([`can't approve: ${covered.summary}`, ...covered.details].join("\n  "))
  }
  const staged = (await git(opts.root, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean)
  if (staged.length) throw new Error(`can't approve: staged files: ${staged.join(", ")}`)
  const read = (f: string) => fs.readFile(path.join(opts.dir, f), "utf8")
  const approval: Approval = {
    date: opts.date ?? new Date().toISOString().slice(0, 10),
    spec: specHash(await read("spec.md"), await read("plan.md")),
    at: (await git(opts.root, ["rev-parse", "--short=12", "HEAD"])).trim(),
  }
  const progressFile = path.join(opts.dir, "progress.md")
  const progress = (await readIfExists(progressFile)) ?? ""
  const sep = progress === "" || progress.endsWith("\n") ? "" : "\n"
  await fs.writeFile(progressFile, `${progress}${sep}${approvalLine(approval)}\n`)
  return approval
}
