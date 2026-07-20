import { run } from "./exec.ts"

export async function git(root: string, args: string[], input?: string): Promise<string> {
  const r = await run("git", args, { cwd: root, input })
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`)
  return r.stdout
}

export async function gitOk(root: string, args: string[]): Promise<boolean> {
  return (await run("git", args, { cwd: root })).code === 0
}

export function featurePath(slug: string): string {
  return `docs/feats/${slug}/`
}

export type GateCommit = { sha: string; writer: string }

const GATE = /^Solodev-Gate:\s*approved\s*$/m
const WRITER = /^Solodev-Writer:\s*(.+?)\s*$/m

/** Approval commits for a feature, oldest first. The first one is the gate; later ones re-approve an edited spec. */
export async function gateCommits(root: string, slug: string): Promise<GateCommit[]> {
  let out: string
  try {
    out = await git(root, ["log", "--reverse", "--format=%H%x1f%B%x1e", "--", featurePath(slug)])
  } catch {
    return []
  }
  const gates: GateCommit[] = []
  for (const record of out.split("\x1e")) {
    const [sha, body = ""] = record.trim().split("\x1f")
    if (!sha || !GATE.test(body)) continue
    gates.push({ sha, writer: body.match(WRITER)?.[1] ?? "" })
  }
  return gates
}

/** The commit this branch forked from: SOLODEV_BASE, else origin's default branch, else main or master. */
export async function resolveBase(root: string, env = process.env): Promise<string | undefined> {
  const candidates: string[] = []
  if (env.SOLODEV_BASE) candidates.push(env.SOLODEV_BASE)
  const originHead = await run("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd: root })
  if (originHead.code === 0 && originHead.stdout.trim()) candidates.push(originHead.stdout.trim())
  candidates.push("main", "master")
  for (const ref of candidates) {
    const r = await run("git", ["merge-base", ref, "HEAD"], { cwd: root })
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim()
  }
  return undefined
}

export type CommitPaths = { sha: string; paths: string[] }

/** Commits in `range` (oldest first) with the paths each one changed. */
export async function commitsWithPaths(root: string, range: string): Promise<CommitPaths[]> {
  const out = await git(root, ["log", "--reverse", "--format=%x1e%H", "--name-only", range])
  return out
    .split("\x1e")
    .map((chunk) => chunk.trim().split("\n").filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map(([sha, ...paths]) => ({ sha: sha!, paths }))
}

/** The commit that first added `file`, or undefined when it was never committed. */
export async function firstAdded(root: string, file: string): Promise<string | undefined> {
  const r = await run("git", ["log", "--reverse", "--diff-filter=A", "--format=%H", "--", file], { cwd: root })
  return r.code === 0 ? r.stdout.split("\n").find(Boolean) : undefined
}

export async function currentBranch(root: string): Promise<string> {
  const r = await run("git", ["branch", "--show-current"], { cwd: root })
  return r.code === 0 ? r.stdout.trim() : ""
}
