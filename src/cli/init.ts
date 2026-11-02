import { createHash } from "node:crypto"
import * as path from "node:path"
import type { Tool } from "./models.ts"

export type Scope = "project" | "global"

/** The shadows `solodev init` writes, by host and file name; build-cli bundles them from dist/<host>/agents. */
export type AgentFiles = Record<Tool, Record<string, string>>

export type InitOp =
  | { kind: "create" | "update" | "unchanged"; path: string; content: string }
  /** The user changed a shadow init wrote; left alone unless --force. */
  | { kind: "edited"; path: string; content: string }
  | { kind: "delete"; path: string; recursive?: boolean; note: string }
  | { kind: "move"; path: string; from: string; note: string }

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
  exists: (filePath: string) => Promise<boolean>
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
 * `<base>/<.claude|.agents|.codex|…>/skills/solodev-mission/scripts/solodev-cli.mjs`. Undefined when it runs from
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
  if (path.basename(scripts) !== "scripts" || path.basename(skill) !== "solodev-mission") return undefined
  if (path.basename(skills) !== "skills") return undefined
  const config = path.dirname(skills)
  const base = path.dirname(config)
  if (env.CODEX_HOME !== undefined && path.resolve(env.CODEX_HOME) === config) return { scope: "global", base: home }
  // A tool's config folder (.claude, .agents, .codex, …); anything else is a build output, not an install.
  if (!path.basename(config).startsWith(".")) return undefined
  return base === home ? { scope: "global", base: home } : { scope: "project", base }
}

/** `<rel>  <sha256>` lines the old installer kept next to what it wrote. */
function parseLegacyManifest(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of (raw ?? "").split("\n")) {
    const i = line.indexOf("  ")
    if (i > 0) map.set(line.slice(i + 2), line.slice(0, i))
  }
  return map
}

const OLD_CLIS = [
  ".agents/solodev/solodev-cli.mjs",
  ".agents/bin/solodev.mjs",
  ".agents/bin/quest-state.mjs",
  ".agents/bin/quest-state",
  ".agents/bin/quest-state.js",
  ".agents/bin/sddkit-state.mjs",
]
const OLD_PROJECT_BINS = ["bin/quest-state", "bin/sdd-state"]
const OLD_CURSOR_SKILLS = ["sddkit", "sddkit-plan", "sddkit-epic", "sddkit-setup-docs", "setup-docs"]
const OLD_INSTALLER = "(left by the old installer)"

/** What `solodev init` would do; nothing is written. */
export async function planInit(input: InitInput): Promise<InitOp[]> {
  const { host, scope, root, home, env } = input
  const dir = agentsDir(host, scope, root, home, env)
  const legacyManifest = path.join(dir, ".harness-manifest")
  const legacy = parseLegacyManifest(await input.read(legacyManifest))
  const ops: InitOp[] = []

  for (const [file, built] of Object.entries(input.agents[host]).sort()) {
    const dest = path.join(dir, file)
    const content = withHash(file, built)
    const current = await input.read(dest)
    let kind: InitOp["kind"]
    if (current === undefined) kind = "create"
    else if (current === content) kind = "unchanged"
    else {
      // No hash line: written by the old installer (its manifest vouches for it) or by someone else.
      const ours = intact(current) ?? legacy.get(file) === sha256(current)
      kind = ours || input.force ? "update" : "edited"
    }
    ops.push({ kind, path: dest, content })
  }

  const remove = async (rel: string, recursive = false) => {
    const target = path.join(root, rel)
    if (await input.exists(target)) ops.push({ kind: "delete", path: target, recursive, note: OLD_INSTALLER })
  }
  if (await input.exists(legacyManifest)) ops.push({ kind: "delete", path: legacyManifest, note: OLD_INSTALLER })
  for (const skills of [".agents/skills", ".claude/skills", ".cursor/skills"])
    await remove(`${skills}/.harness-manifest`)
  for (const rel of OLD_CLIS) await remove(rel)
  if (scope === "project") for (const rel of OLD_PROJECT_BINS) await remove(rel)
  if (host === "cursor") for (const name of OLD_CURSOR_SKILLS) await remove(`.cursor/skills/${name}`, true)

  // Personal defaults moved from ~/.agents/solodev.yaml; an existing new file wins.
  const oldConf = path.join(home, ".agents", "solodev.yaml")
  const conf = path.join(home, ".agents", "solodev", "solodev-conf.yaml")
  if ((await input.exists(oldConf)) && !(await input.exists(conf))) {
    ops.push({ kind: "move", path: conf, from: oldConf, note: "(personal defaults' new name)" })
  }
  return ops
}

export type InitFs = {
  write: (filePath: string, content: string) => Promise<void>
  remove: (filePath: string, recursive: boolean) => Promise<void>
  move: (from: string, to: string) => Promise<void>
}

export async function applyInit(ops: InitOp[], fs: InitFs): Promise<void> {
  for (const op of ops) {
    if (op.kind === "create" || op.kind === "update") await fs.write(op.path, op.content)
    else if (op.kind === "delete") await fs.remove(op.path, op.recursive ?? false)
    else if (op.kind === "move") await fs.move(op.from, op.path)
  }
}

const VERB: Record<InitOp["kind"], string> = {
  create: "+ created  ",
  update: "~ updated  ",
  unchanged: "= unchanged",
  edited: "! edited   ",
  delete: "- removed  ",
  move: "> moved    ",
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
    if (op.kind === "move") line += ` from ${show(op.from)}`
    if (op.kind === "delete" || op.kind === "move") line += ` ${op.note}`
    if (op.kind === "edited") line += " — kept your edits; --force replaces them"
    lines.push(line)
  }
  return lines.join("\n")
}
