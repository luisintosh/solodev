import * as path from "node:path"
import { parse as parseYaml } from "yaml"
import { agentsDir, type Scope } from "./init.ts"
import { isTool, type Models, TOOLS, type Tool } from "./models.ts"

export type ProbeDeps = {
  env: Record<string, string | undefined>
  root: string
  /** The repo's folder of features, outside the repo (state.ts). */
  state: string
  home: string
  /** Whether this session can create files in `dir`; it runs inside the agent's sandbox. */
  writable: (dir: string) => Promise<boolean>
  /** Runs a command; never throws. `code` is null when the binary could not start. */
  exec: (cmd: string, args: string[]) => Promise<{ code: number | null; stdout: string }>
  which: (bin: string) => Promise<boolean>
  exists: (filePath: string) => Promise<boolean>
  read: (filePath: string) => Promise<string | undefined>
  /** The scopes where init would update or remove one of this tool's shadows. */
  stale?: (tool: Tool) => Promise<Scope[]>
}

export type ToolProbe = {
  cli: string
  installed: boolean
  /** null when there's no cheap way to tell. */
  loggedIn: boolean | null
  /** solodev's coder skill is where this tool looks for skills. */
  skills: boolean
  /** `solodev init` wrote every shadow for this tool, in this repo or globally, and none is out of date. */
  shadows: boolean
  /** What the coder starts on: `<model>/<effort>` as written (`sonnet/high`), or `session`. */
  coder: string
}

export type WriterOption = { tool: Tool; coder: string; recommended: boolean }

/**
 * Personal defaults from `~/.agents/solodev/solodev-conf.yaml`; usage limits belong to a person, not a repo. `coder`
 * holds the user's `<model>/<effort>` (or `session`) per tool, passed through as written.
 */
export type Defaults = { writer: Tool | "ask"; coder: Partial<Record<Tool, string>> }

export type Probe = {
  home: Tool | null
  tools: Record<Tool, ToolProbe>
  /** Where feature folders go (`<dir>/<slug>/`). */
  state: { dir: string; writable: boolean }
  defaults: Defaults
  writers: WriterOption[]
  warnings: string[]
}

const BINARIES: Record<Tool, string> = { claude: "claude", codex: "codex", cursor: "agent" }

/** The skill a coder on this tool loads, relative to the repo or $HOME. */
export const CODER_SKILL = "solo-code"
const SKILL_DIRS: Record<Tool, string[]> = {
  claude: [".claude/skills"],
  codex: [".agents/skills", ".codex/skills"],
  cursor: [".agents/skills", ".cursor/skills", ".claude/skills"],
}
export const SHADOWS = ["shadow-coder"]

export function parseDefaults(raw: string | undefined, warnings: string[]): Defaults {
  const out: Defaults = { writer: "ask", coder: {} }
  if (raw === undefined) return out
  let doc: { writer?: unknown; dispatch?: unknown; coder?: unknown }
  try {
    doc = (parseYaml(raw) ?? {}) as typeof doc
  } catch {
    warnings.push("~/.agents/solodev/solodev-conf.yaml is not valid YAML; using writer: ask")
    return out
  }
  if (doc.writer !== undefined) {
    if (doc.writer === "ask" || (typeof doc.writer === "string" && isTool(doc.writer))) out.writer = doc.writer
    else
      warnings.push(
        `~/.agents/solodev/solodev-conf.yaml: writer must be ask, claude, codex or cursor (got ${doc.writer})`,
      )
  }
  if (doc.coder !== undefined) {
    if (!doc.coder || typeof doc.coder !== "object" || Array.isArray(doc.coder)) {
      warnings.push(
        "~/.agents/solodev/solodev-conf.yaml: coder must map a tool to <model>/<effort>, e.g. claude: opus/high",
      )
    } else {
      for (const [tool, value] of Object.entries(doc.coder as Record<string, unknown>)) {
        if (!isTool(tool))
          warnings.push(`~/.agents/solodev/solodev-conf.yaml: coder.${tool} is not claude, codex or cursor`)
        else if (typeof value !== "string" || !value.trim())
          warnings.push(`~/.agents/solodev/solodev-conf.yaml: coder.${tool} must be <model>/<effort> or session`)
        else out.coder[tool] = value.trim()
      }
    }
  }
  if (doc.dispatch !== undefined) {
    warnings.push(
      "~/.agents/solodev/solodev-conf.yaml: dispatch is no longer used; shadows run natively, and a coder on another tool through whatever can run it",
    )
  }
  return out
}

/** The coding tool this process runs inside, from the environment each one sets. SOLODEV_HOME overrides. */
export function detectHome(env: ProbeDeps["env"]): Tool | null {
  const forced = env.SOLODEV_HOME
  if (forced && (TOOLS as readonly string[]).includes(forced)) return forced as Tool
  if (env.CLAUDECODE) return "claude"
  if (env.CURSOR_AGENT) return "cursor"
  if (env.CODEX_SANDBOX || env.CODEX_THREAD_ID) return "codex"
  return null
}

async function loggedIn(deps: ProbeDeps, tool: Tool): Promise<boolean | null> {
  if (tool === "claude") {
    const r = await deps.exec("claude", ["auth", "status"])
    try {
      return Boolean(JSON.parse(r.stdout).loggedIn)
    } catch {
      return r.code === null ? false : null
    }
  }
  if (tool === "codex") {
    const r = await deps.exec("codex", ["login", "status"])
    return r.code === null ? false : r.code === 0
  }
  const r = await deps.exec("agent", ["status"])
  if (r.code !== 0) return r.code === null ? false : null
  return /logged in/i.test(r.stdout) && !/not logged in/i.test(r.stdout)
}

async function hasShadows(deps: ProbeDeps, tool: Tool): Promise<boolean> {
  const ext = tool === "codex" ? "toml" : "md"
  for (const [scope, root] of [
    ["project", deps.root],
    ["global", deps.home],
  ] as const) {
    const dir = agentsDir(tool, scope, root, deps.home, deps.env)
    const found = await Promise.all(SHADOWS.map((name) => deps.exists(path.join(dir, `${name}.${ext}`))))
    if (found.every(Boolean)) return true
  }
  return false
}

async function hasSkill(deps: ProbeDeps, tool: Tool): Promise<boolean> {
  for (const base of [deps.root, deps.home]) {
    for (const dir of SKILL_DIRS[tool]) {
      if (await deps.exists(path.join(base, dir, CODER_SKILL, "SKILL.md"))) return true
    }
  }
  return false
}

export async function probe(deps: ProbeDeps, models: Models): Promise<Probe> {
  const home = detectHome(deps.env)
  const warnings: string[] = []
  // First: the user's `coder` overrides the catalog's in every tool's row and writer option.
  const defaults = parseDefaults(
    await deps.read(path.join(deps.home, ".agents", "solodev", "solodev-conf.yaml")),
    warnings,
  )
  const probed = await Promise.all(
    TOOLS.map(async (tool): Promise<[Tool, ToolProbe]> => {
      const cli = BINARIES[tool]
      const installed = await deps.which(cli)
      return [
        tool,
        {
          cli,
          installed,
          loggedIn: installed ? await loggedIn(deps, tool) : false,
          skills: await hasSkill(deps, tool),
          shadows: await hasShadows(deps, tool),
          coder: defaults.coder[tool] ?? models[tool].coder,
        },
      ]
    }),
  )
  const tools = Object.fromEntries(probed) as Record<Tool, ToolProbe>
  if (!home) warnings.push("couldn't tell which coding tool runs this session; set SOLODEV_HOME=claude|codex|cursor")
  else if (!tools[home].shadows) warnings.push(`${home} has no solodev shadows yet; run /solo-task init`)
  else {
    // A shadow an earlier release wrote, or a retired one still installed: out of date until init runs there.
    const stale = (await deps.stale?.(home)) ?? []
    if (stale.length) tools[home].shadows = false
    for (const scope of stale) {
      warnings.push(`${home}'s solodev shadows (${scope}) are out of date; run /solo-task init --${scope}`)
    }
  }

  const writable = await deps.writable(deps.state)
  if (!writable) warnings.push(`can't write to ${deps.state}; allow it in this tool's sandbox before /solo-task`)

  // Another tool first: it saves the home tool's usage and gives every PR a review from another model family.
  const writers: WriterOption[] = []
  const offer = (tool: Tool) =>
    writers.push({
      tool,
      coder: tools[tool].coder,
      recommended: writers.length === 0,
    })
  for (const tool of TOOLS) {
    const t = tools[tool]
    if (tool === home || !t.installed || t.loggedIn === false) continue
    offer(tool)
  }
  if (home) offer(home)
  if (defaults.writer !== "ask" && !writers.some((w) => w.tool === defaults.writer)) {
    warnings.push(`writer: ${defaults.writer} is set, but that tool can't write here; ask at the gate instead`)
  }

  return {
    home,
    tools,
    state: { dir: deps.state, writable },
    defaults,
    writers,
    warnings,
  }
}
