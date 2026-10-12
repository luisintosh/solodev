import * as path from "node:path"
import { run } from "./exec.ts"

/** Where feature folders live, outside every repo: `SOLODEV_STATE`, else `~/.agents/solodev`. */
export function stateRoot(env: NodeJS.ProcessEnv, home: string): string {
  return env.SOLODEV_STATE ? path.resolve(env.SOLODEV_STATE) : path.join(home, ".agents", "solodev")
}

const SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * `owner/repo` (GitLab subgroups kept) from a remote URL, whether scp-style SSH (`git@host:owner/repo.git`) or a URL
 * (`ssh://`, `https://`, with or without credentials). Undefined for a local path or `file://`.
 */
export function keyFromRemote(url: string): string | undefined {
  const trimmed = url.trim()
  let rest: string | undefined
  const scheme = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(.*)$/i)
  if (scheme) {
    if (/^file:/i.test(trimmed)) return undefined
    // Drop credentials and host (with any port); keep the path.
    rest = scheme[1]!.replace(/^[^/]*/, "")
  } else {
    const scp = trimmed.match(/^(?:[^@/\s]+@)?[^:/\s]+:(.+)$/)
    if (!scp) return undefined
    rest = scp[1]
  }
  const segments = rest!
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean)
  if (!segments.length || segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) return undefined
  return segments.join("/")
}

/** The folder name of the main checkout, the same from every worktree. */
async function checkoutName(repoRoot: string): Promise<string> {
  const r = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repoRoot })
  const common = r.code === 0 ? r.stdout.trim() : ""
  const name = path.basename(common && path.basename(common) === ".git" ? path.dirname(common) : repoRoot)
  return SEGMENT.test(name) && name !== "." && name !== ".." ? name : "repo"
}

/** This repo's key under the state root: origin's `owner/repo`, else the main checkout's folder name. */
export async function repoKey(repoRoot: string): Promise<string> {
  const origin = await run("git", ["remote", "get-url", "origin"], { cwd: repoRoot })
  return (origin.code === 0 && keyFromRemote(origin.stdout)) || (await checkoutName(repoRoot))
}

/** The folder holding this repo's feature folders. */
export async function stateDir(repoRoot: string, env: NodeJS.ProcessEnv, home: string): Promise<string> {
  return path.join(stateRoot(env, home), await repoKey(repoRoot))
}
