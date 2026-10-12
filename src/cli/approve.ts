import { coverage } from "./checks.ts"
import { featurePath, git } from "./git.ts"
import { type Models, type Tool, writerId } from "./models.ts"

export type Dispatch = "native" | "orca"

export type ApproveOptions = { root: string; slug: string; writer: Tool; via: Dispatch; models: Models }

export type Approval = { sha: string; message: string }

/**
 * Commits the feature's spec and plan as the spec gate. Refuses when the plan doesn't cover the spec (C2) or when
 * anything outside the feature folder is staged, so the gate commit holds the approved documents and nothing else.
 */
export async function approve(opts: ApproveOptions): Promise<Approval> {
  const covered = await coverage(opts.root, opts.slug, false)
  if (covered.status !== "pass") {
    throw new Error([`can't approve: ${covered.summary}`, ...covered.details].join("\n  "))
  }
  const dir = featurePath(opts.slug)
  await git(opts.root, ["add", "--", dir])
  const staged = (await git(opts.root, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean)
  const outside = staged.filter((p) => !p.startsWith(dir))
  if (outside.length) throw new Error(`can't approve: staged files outside ${dir}: ${outside.join(", ")}`)
  const writer = `${writerId(opts.writer, opts.models[opts.writer].implement)} via ${opts.via}`
  const message = `docs: approve spec for ${opts.slug.replaceAll("-", " ")}\n\nSolodev-Gate: approved\nSolodev-Writer: ${writer}\n`
  await git(opts.root, ["commit", "--quiet", "--allow-empty", "--file", "-"], message)
  const sha = (await git(opts.root, ["rev-parse", "HEAD"])).trim()
  return { sha, message }
}
