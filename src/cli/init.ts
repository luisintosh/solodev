import { createHash } from "node:crypto"
import * as path from "node:path"
import type { Tool } from "./models.ts"

export type Scope = "project" | "global"

/** The shadows `solodev init` writes, by host and file name, read from the skill's `shadows/<host>/`. */
export type AgentFiles = Record<Tool, Record<string, string>>

export type InitOp =
  | { kind: "create" | "update" | "unchanged"; path: string; content: string }
  /** The user changed a shadow init wrote; left alone unless --force. */
  | { kind: "edited"; path: string; content: string }
  /** A repo path that resolves outside the repo (a symlinked folder): left alone. */
  | { kind: "outside"; path: string }

export type InitInput = {
  host: Tool
  scope: Scope
  /** The repo for a project init, $HOME for a global one. */
  root: string
  home: string
  env: Record<string, string | undefined>
  agents: AgentFiles
  force: boolean
  read: (filePath: string) => Promise<string | undefined>
  /**
   * Whether a path's folder resolves inside `root` once symlinks are followed (the path itself may be a link; a write
   * replaces the link, not its target). A project init touches nothing a cloned repo's symlinks point
   * elsewhere; a global one trusts $HOME, where linking dotfolders is common.
   */
  inside: (filePath: string) => Promise<boolean>
}

const MARK = /\n(?:<!-- solodev-hash: ([0-9a-f]{16}) -->|# solodev-hash: ([0-9a-f]{16}))\n?$/

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/** A shadow as init writes it: the built file plus a last line holding its hash, so a later init can spot edits. */
export function withHash(file: string, content: string): string {
  const hash = sha256(content).slice(0, 16)
  return `${content}${file.endsWith(".toml") ? `# solodev-hash: ${hash}` : `<!-- solodev-hash: ${hash} -->`}\n`
}

export function stripHash(content: string): string {
  return content.replace(MARK, "\n")
}

/** Whether a shadow still holds what init wrote; undefined when it carries no hash line. */
export function intact(content: string): boolean | undefined {
  const m = content.match(MARK)
  if (!m) return undefined
  return sha256(stripHash(content)).slice(0, 16) === (m[1] ?? m[2])
}

/** Where a host reads custom agents. */
export function agentsDir(host: Tool, scope: Scope, root: string, home: string, env: InitInput["env"]): string {
  if (host === "codex") {
    return scope === "global"
      ? path.join(env.CODEX_HOME || path.join(home, ".codex"), "agents")
      : path.join(root, ".codex", "agents")
  }
  return path.join(scope === "global" ? home : root, host === "claude" ? ".claude" : ".cursor", "agents")
}

/**
 * The scope the skill was installed with, from this CLI's real path:
 * `<base>/<.claude|.agents|.codex|…>/skills/mission/scripts/solodev-cli.mjs`. Undefined when it runs from
 * anywhere else (a checkout's dist/).
 */
export function locate(
  cliPath: string,
  home: string,
  env: InitInput["env"],
): { scope: Scope; base: string } | undefined {
  const scripts = path.dirname(cliPath)
  const skill = path.dirname(scripts)
  const skills = path.dirname(skill)
  if (path.basename(scripts) !== "scripts" || path.basename(skill) !== "mission") return undefined
  if (path.basename(skills) !== "skills") return undefined
  const config = path.dirname(skills)
  const base = path.dirname(config)
  if (env.CODEX_HOME !== undefined && path.resolve(env.CODEX_HOME) === config) return { scope: "global", base: home }
  // A tool's config folder (.claude, .agents, .codex, …); anything else is a build output, not an install.
  if (!path.basename(config).startsWith(".")) return undefined
  return base === home ? { scope: "global", base: home } : { scope: "project", base }
}

/** What `solodev init` would do; nothing is written. */
export async function planInit(input: InitInput): Promise<InitOp[]> {
  const dir = agentsDir(input.host, input.scope, input.root, input.home, input.env)
  const dirInside = await input.inside(path.join(dir, "shadow"))
  const ops: InitOp[] = []
  for (const [file, built] of Object.entries(input.agents[input.host]).sort()) {
    const dest = path.join(dir, file)
    if (!dirInside) {
      ops.push({ kind: "outside", path: dest })
      continue
    }
    const content = withHash(file, built)
    const current = await input.read(dest)
    let kind: InitOp["kind"]
    if (current === undefined) kind = "create"
    else if (current === content) kind = "unchanged"
    else kind = intact(current) || input.force ? "update" : "edited"
    ops.push({ kind, path: dest, content })
  }
  return ops
}

export async function applyInit(ops: InitOp[], write: (filePath: string, content: string) => Promise<void>) {
  for (const op of ops) if (op.kind === "create" || op.kind === "update") await write(op.path, op.content)
}

const VERB: Record<InitOp["kind"], string> = {
  create: "+ created  ",
  update: "~ updated  ",
  unchanged: "= unchanged",
  edited: "! edited   ",
  outside: "! outside  ",
}

export function formatInit(input: Pick<InitInput, "host" | "scope" | "root" | "home">, ops: InitOp[], dryRun: boolean) {
  const under = (dir: string, p: string) => p.startsWith(`${dir}${path.sep}`)
  const show = (p: string) => {
    if (input.scope === "project" && under(input.root, p)) return path.relative(input.root, p)
    if (under(input.home, p)) return `~/${path.relative(input.home, p)}`
    return p
  }
  const lines = [`solodev init ${input.host} (${input.scope}: ${input.scope === "global" ? "~" : input.root})`]
  if (dryRun) lines[0] += " — dry run, nothing written"
  for (const op of ops) {
    let line = `  ${VERB[op.kind]} ${show(op.path)}`
    if (op.kind === "edited") line += " — kept your edits; --force replaces them"
    if (op.kind === "outside") line += " — a symlink leads outside the repo; left alone"
    lines.push(line)
  }
  return lines.join("\n")
}
