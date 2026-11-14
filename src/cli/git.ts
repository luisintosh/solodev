import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
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

/**
 * A hash of the working tree as it stands: tracked and untracked files, not ignored ones. Built in a throwaway index
 * and a throwaway object store that reads the project's own as an alternate, so nothing in the project's `.git`
 * changes; it stays the same when that tree is later committed.
 */
export async function treeHash(root: string): Promise<string> {
  const gitPath = async (name: string) =>
    (await git(root, ["rev-parse", "--path-format=absolute", "--git-path", name])).trim()
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "solodev-tree-"))
  const index = path.join(tmp, "index")
  const objects = path.join(tmp, "objects")
  const opts = {
    cwd: root,
    env: {
      GIT_INDEX_FILE: index,
      GIT_OBJECT_DIRECTORY: objects,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: await gitPath("objects"),
    },
  }
  try {
    await fs.mkdir(objects)
    // The project's index carries the stat data that lets `add` skip unchanged files; without one, start from HEAD's
    // tree, or empty in a repo with no commit.
    const seeded = await fs.copyFile(await gitPath("index"), index).then(
      () => true,
      () => false,
    )
    if (!seeded) await run("git", ["read-tree", "HEAD"], opts)
    const add = await run("git", ["add", "-A"], opts)
    if (add.code !== 0) throw new Error(`git add failed: ${add.stderr.trim()}`)
    const tree = await run("git", ["write-tree"], opts)
    if (tree.code !== 0) throw new Error(`git write-tree failed: ${tree.stderr.trim()}`)
    return tree.stdout.trim().slice(0, 12)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

export async function currentBranch(root: string): Promise<string> {
  const r = await run("git", ["branch", "--show-current"], { cwd: root })
  return r.code === 0 ? r.stdout.trim() : ""
}
