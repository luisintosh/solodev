import { run } from "./exec.ts"

export async function git(root: string, args: string[], input?: string): Promise<string> {
  const r = await run("git", args, { cwd: root, input })
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`)
  return r.stdout
}

export async function gitOk(root: string, args: string[]): Promise<boolean> {
  return (await run("git", args, { cwd: root })).code === 0
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

export async function currentBranch(root: string): Promise<string> {
  const r = await run("git", ["branch", "--show-current"], { cwd: root })
  return r.code === 0 ? r.stdout.trim() : ""
}
