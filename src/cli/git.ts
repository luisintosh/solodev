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

/** Where the base came from: the env override, the feature's `- base` line, or the repo's default branch. */
export type BaseSource = "SOLODEV_BASE" | "- base" | "default"
/** The commit this branch forked from, and the ref that named it. */
export type Base = { ref: string; sha: string; from: BaseSource }

const forkPoint = async (root: string, ref: string) => {
  const r = await run("git", ["merge-base", ref, "HEAD"], { cwd: root })
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : undefined
}

/** Of two commits, the later one when one descends from the other, else the first. */
const later = async (root: string, a: string, b: string) =>
  (await run("git", ["merge-base", "--is-ancestor", a, b], { cwd: root })).code === 0 ? b : a

/**
 * The commit this branch forked from: SOLODEV_BASE, else the feature's recorded base (the branch its PR targets,
 * tried on origin and locally, the later fork point winning so a stale copy doesn't), else origin's default branch,
 * else main or master. A ref given by the first two that resolves nowhere throws rather than falling back.
 */
export async function resolveBase(root: string, env = process.env, recorded?: string): Promise<Base | undefined> {
  const named: [string, BaseSource][] = []
  if (env.SOLODEV_BASE) named.push([env.SOLODEV_BASE, "SOLODEV_BASE"])
  else if (recorded) named.push([recorded, "- base"])
  for (const [ref, from] of named) {
    // It reaches git as an argument.
    if (ref.startsWith("-")) throw new Error(`base ${ref} (${from}) isn't a branch name`)
    const refs = ref.startsWith("origin/") ? [ref] : [`origin/${ref}`, ref]
    let found: { ref: string; sha: string } | undefined
    for (const r of refs) {
      const sha = await forkPoint(root, r)
      if (!sha) continue
      if (!found || (await later(root, found.sha, sha)) === sha) found = { ref: r, sha }
    }
    if (!found) {
      const fix =
        from === "SOLODEV_BASE" ? "set SOLODEV_BASE to a branch that exists" : "log the new one as `- base <ref>`"
      throw new Error(`base ${ref} (${from}) not found — ${fix}`)
    }
    return { ...found, from }
  }
  const defaults: string[] = []
  const originHead = await run("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd: root })
  if (originHead.code === 0 && originHead.stdout.trim()) defaults.push(originHead.stdout.trim())
  defaults.push("main", "master")
  for (const ref of defaults) {
    const sha = await forkPoint(root, ref)
    if (sha) return { ref, sha, from: "default" }
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
