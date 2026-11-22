import { createHash } from "node:crypto"
import * as path from "node:path"
import type { Tool } from "./models.ts"

export type Scope = "project" | "global"

/** The shadows `solodev init` writes, by host and file name, read from the skill's `shadows/<host>/`. */
export type AgentFiles = Record<Tool, Record<string, string>>

/** Shadows earlier releases wrote; init removes one it wrote and nobody changed since. */
export const RETIRED_SHADOWS = ["shadow-spec-reviewer", "shadow-reviewer", "shadow-verifier"]

export type InitOp =
  | { kind: "create" | "update" | "unchanged"; path: string; content: string }
  /** The user changed a shadow init wrote; left alone unless --force. */
  | { kind: "edited"; path: string; content: string }
  /** A repo path that resolves outside the repo (a symlinked folder): left alone. */
  | { kind: "outside"; path: string }
  /** A retired shadow init wrote, unchanged since: deleted. */
  | { kind: "remove"; path: string }
  /** A retired shadow the user changed, or one init didn't write: left alone. */
  | { kind: "kept"; path: string }

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
 * `<base>/<.claude|.agents|.codex|…>/skills/solo-task/scripts/solodev-cli.mjs`. Undefined when it runs from
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
  if (path.basename(scripts) !== "scripts" || path.basename(skill) !== "solo-task") return undefined
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
  if (!dirInside) return ops
  const ext = input.host === "codex" ? "toml" : "md"
  for (const name of RETIRED_SHADOWS) {
    const dest = path.join(dir, `${name}.${ext}`)
    const current = await input.read(dest)
    if (current === undefined) continue
    ops.push({ kind: intact(current) ? "remove" : "kept", path: dest })
  }
  return ops
}

/** The scopes where `solodev init` would update or remove a shadow: what's installed there is out of date. */
export async function staleScopes(inputs: InitInput[]): Promise<Scope[]> {
  const out: Scope[] = []
  for (const input of inputs) {
    const ops = await planInit(input)
    if (ops.some((op) => op.kind === "update" || op.kind === "remove")) out.push(input.scope)
  }
  return out
}

export async function applyInit(
  ops: InitOp[],
  write: (filePath: string, content: string) => Promise<void>,
  remove: (filePath: string) => Promise<void>,
) {
  for (const op of ops) {
    if (op.kind === "create" || op.kind === "update") await write(op.path, op.content)
    else if (op.kind === "remove") await remove(op.path)
  }
}

const VERB: Record<InitOp["kind"], string> = {
  create: "+ created  ",
  update: "~ updated  ",
  unchanged: "= unchanged",
  edited: "! edited   ",
  outside: "! outside  ",
  remove: "- removed  ",
  kept: "! kept     ",
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
    if (op.kind === "remove") line += " — retired; solodev starts this role as a generic subagent now"
    if (op.kind === "kept") line += " — retired, but you changed it; delete it when you're done with it"
    lines.push(line)
  }
  return lines.join("\n")
}
