import * as path from "node:path"
import { COMMAND_NAMES, parseCommands } from "./feature.ts"
import { type Models, TOOLS, type Tool, writerId } from "./models.ts"

export type ProbeDeps = {
  env: Record<string, string | undefined>
  platform: string
  root: string
  home: string
  /** Runs a command; never throws. `code` is null when the binary could not start. */
  exec: (cmd: string, args: string[]) => Promise<{ code: number | null; stdout: string }>
  which: (bin: string) => Promise<boolean>
  exists: (filePath: string) => Promise<boolean>
  read: (filePath: string) => Promise<string | undefined>
}

export type ToolProbe = {
  cli: string
  installed: boolean
  /** null when there's no cheap way to tell. */
  loggedIn: boolean | null
  /** solodev's coder skill is where this tool looks for skills. */
  skills: boolean
  think: string
  implement: string
}

export type WriterOption = { tool: Tool; via: "native" | "orca"; model: string; recommended: boolean }

export type Probe = {
  home: Tool | null
  tools: Record<Tool, ToolProbe>
  orca: { cli: string; ready: boolean; reason: string }
  gh: { installed: boolean; loggedIn: boolean }
  agentsMd: { found: boolean; lines: number; commands: Record<string, string | null>; missing: string[] }
  writers: WriterOption[]
  warnings: string[]
}

const BINARIES: Record<Tool, string> = { claude: "claude", codex: "codex", cursor: "cursor-agent" }

/** The skill a coder on this tool loads, relative to the repo or $HOME. */
export const CODER_SKILL = "arise"
const SKILL_DIRS: Record<Tool, string[]> = {
  claude: [".claude/skills"],
  codex: [".agents/skills"],
  cursor: [".agents/skills", ".cursor/skills", ".claude/skills"],
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
  const r = await deps.exec("cursor-agent", ["status"])
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
  if (!agents) warnings.push("AGENTS.md not found — run /arise-scout")
  else if (missing.length) warnings.push(`AGENTS.md ## Commands is missing ${missing.join(", ")}`)
  if (lines > 100)
    warnings.push(`AGENTS.md is ${lines} lines; keep it near the commands list (about 100 lines at most)`)
  if (!home) warnings.push("couldn't tell which coding tool runs this session; set SOLODEV_HOME=claude|codex|cursor")

  // Another tool first: it saves the home tool's usage and gives every PR a review from another model family.
  const writers: WriterOption[] = []
  for (const tool of TOOLS) {
    const t = tools[tool]
    if (tool === home || !orca.ready || !t.installed || t.loggedIn === false || !t.skills) continue
    writers.push({ tool, via: "orca", model: t.implement, recommended: writers.length === 0 })
  }
  if (home) writers.push({ tool: home, via: "native", model: tools[home].implement, recommended: writers.length === 0 })

  return {
    home,
    tools,
    orca,
    gh: { installed: ghInstalled, loggedIn: ghLoggedIn },
    agentsMd: { found: agents !== undefined, lines, commands: Object.fromEntries(commands), missing },
    writers,
    warnings,
  }
}
