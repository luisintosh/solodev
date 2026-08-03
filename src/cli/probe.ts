import * as path from "node:path"
import { parse as parseYaml } from "yaml"
import { COMMAND_NAMES, parseCommands } from "./feature.ts"
import { isTool, type ModelRef, type Models, TOOLS, type Tool, writerId } from "./models.ts"

export type ProbeDeps = {
  env: Record<string, string | undefined>
  platform: string
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
}

/** What `orca orchestration worker-start --agent <agent> --model <model> --effort <effort>` takes. */
export type Launch = { agent: Tool; model: string; effort?: string }

export type ToolProbe = {
  cli: string
  installed: boolean
  /** null when there's no cheap way to tell. */
  loggedIn: boolean | null
  /** solodev's coder skill is where this tool looks for skills. */
  skills: boolean
  think: string
  implement: string
  launch: { think: Launch; implement: Launch }
}

export type WriterOption = { tool: Tool; via: "native" | "orca"; model: string; launch: Launch; recommended: boolean }

/** Personal defaults from `~/.agents/solodev.yaml`; usage limits belong to a person, not a repo. */
export type Defaults = { writer: Tool | "ask"; dispatch: "auto" | "orca" }

export type Probe = {
  home: Tool | null
  tools: Record<Tool, ToolProbe>
  orca: { cli: string; ready: boolean; reason: string }
  gh: { installed: boolean; loggedIn: boolean }
  agentsMd: { found: boolean; lines: number; commands: Record<string, string | null>; missing: string[] }
  /** Where feature folders go (`<dir>/<slug>/`). */
  state: { dir: string; writable: boolean }
  defaults: Defaults
  writers: WriterOption[]
  warnings: string[]
}

const BINARIES: Record<Tool, string> = { claude: "claude", codex: "codex", cursor: "agent" }

/** The skill a coder on this tool loads, relative to the repo or $HOME. */
export const CODER_SKILL = "arise-coder"
const SKILL_DIRS: Record<Tool, string[]> = {
  claude: [".claude/skills"],
  codex: [".agents/skills"],
  cursor: [".agents/skills", ".cursor/skills", ".claude/skills"],
}

function launch(tool: Tool, ref: ModelRef): Launch {
  return ref.effort ? { agent: tool, model: ref.id, effort: ref.effort } : { agent: tool, model: ref.id }
}

export function parseDefaults(raw: string | undefined, warnings: string[]): Defaults {
  const out: Defaults = { writer: "ask", dispatch: "auto" }
  if (raw === undefined) return out
  let doc: { writer?: unknown; dispatch?: unknown }
  try {
    doc = (parseYaml(raw) ?? {}) as typeof doc
  } catch {
    warnings.push("~/.agents/solodev.yaml is not valid YAML; using writer: ask, dispatch: auto")
    return out
  }
  if (doc.writer !== undefined) {
    if (doc.writer === "ask" || (typeof doc.writer === "string" && isTool(doc.writer))) out.writer = doc.writer
    else warnings.push(`~/.agents/solodev.yaml: writer must be ask, claude, codex or cursor (got ${doc.writer})`)
  }
  if (doc.dispatch !== undefined) {
    if (doc.dispatch === "auto" || doc.dispatch === "orca") out.dispatch = doc.dispatch
    else warnings.push(`~/.agents/solodev.yaml: dispatch must be auto or orca (got ${doc.dispatch})`)
  }
  return out
}

/** Same resolution order as Orca's orchestration skill. */
export function resolveOrcaCli(env: ProbeDeps["env"], platform: string): string {
  if (env.ORCA_CLI_COMMAND) return env.ORCA_CLI_COMMAND
  if (env.ORCA_DEV_REPO_ROOT) return "orca-dev"
  // Bare `orca` on Linux outside Orca is usually the GNOME screen reader.
  if (platform === "linux" && !env.ORCA_TERMINAL_HANDLE) return "orca-ide"
  return "orca"
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

async function probeOrca(deps: ProbeDeps): Promise<Probe["orca"]> {
  const cli = resolveOrcaCli(deps.env, deps.platform)
  const status = await deps.exec(cli, ["status", "--json"])
  if (status.code === null) return { cli, ready: false, reason: `${cli} not found` }
  let state = "unknown"
  try {
    const parsed = JSON.parse(status.stdout) as { ok?: boolean; result?: { runtime?: { state?: string } } }
    state = parsed.ok ? (parsed.result?.runtime?.state ?? "unknown") : "unknown"
  } catch {
    return { cli, ready: false, reason: `${cli} status --json returned no JSON` }
  }
  if (state !== "ready") return { cli, ready: false, reason: `runtime ${state}` }
  const skills = await deps.exec(cli, ["skills", "installed"])
  if (!/^orchestration\b/m.test(skills.stdout)) {
    return { cli, ready: false, reason: "the orchestration skill isn't installed (orca skills install)" }
  }
  return { cli, ready: true, reason: "ok" }
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
          think: writerId(tool, models[tool].think),
          implement: writerId(tool, models[tool].implement),
          launch: { think: launch(tool, models[tool].think), implement: launch(tool, models[tool].implement) },
        },
      ]
    }),
  )
  const tools = Object.fromEntries(probed) as Record<Tool, ToolProbe>
  const [orca, ghInstalled] = await Promise.all([probeOrca(deps), deps.which("gh")])
  const ghLoggedIn = ghInstalled && (await deps.exec("gh", ["auth", "status"])).code === 0

  const agents = await deps.read(path.join(deps.root, "AGENTS.md"))
  const commands = parseCommands(agents ?? "")
  const missing = COMMAND_NAMES.filter((n) => !commands.has(n))
  const lines = agents ? agents.split("\n").length : 0
  if (!agents) warnings.push("AGENTS.md not found; find the commands this session (optional: run /arise-scout)")
  else if (missing.length) {
    warnings.push(
      `AGENTS.md ## Commands doesn't list ${missing.join(", ")}; find them this session (optional: run /arise-scout)`,
    )
  }
  if (lines > 100)
    warnings.push(`AGENTS.md is ${lines} lines; keep it near the commands list (about 100 lines at most)`)
  if (!home) warnings.push("couldn't tell which coding tool runs this session; set SOLODEV_HOME=claude|codex|cursor")

  const writable = await deps.writable(deps.state)
  if (!writable) warnings.push(`can't write to ${deps.state}; allow it in this tool's sandbox before /arise`)

  const defaults = parseDefaults(await deps.read(path.join(deps.home, ".agents", "solodev.yaml")), warnings)
  if (defaults.dispatch === "orca" && !orca.ready) {
    warnings.push(`dispatch: orca, but Orca isn't ready (${orca.reason}); shadows run natively`)
  }

  // Another tool first: it saves the home tool's usage and gives every PR a review from another model family.
  const writers: WriterOption[] = []
  const offer = (tool: Tool, via: WriterOption["via"]) =>
    writers.push({
      tool,
      via,
      model: tools[tool].implement,
      launch: tools[tool].launch.implement,
      recommended: writers.length === 0,
    })
  for (const tool of TOOLS) {
    const t = tools[tool]
    if (tool === home || !orca.ready || !t.installed || t.loggedIn === false || !t.skills) continue
    offer(tool, "orca")
  }
  if (home) offer(home, defaults.dispatch === "orca" && orca.ready ? "orca" : "native")
  if (defaults.writer !== "ask" && !writers.some((w) => w.tool === defaults.writer)) {
    warnings.push(`writer: ${defaults.writer} is set, but that tool can't write here; ask at the gate instead`)
  }

  return {
    home,
    tools,
    orca,
    gh: { installed: ghInstalled, loggedIn: ghLoggedIn },
    agentsMd: { found: agents !== undefined, lines, commands: Object.fromEntries(commands), missing },
    state: { dir: deps.state, writable },
    defaults,
    writers,
    warnings,
  }
}
