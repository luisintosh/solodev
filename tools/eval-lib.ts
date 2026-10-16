/** Shared by the outcome evals (eval.ts) and the stage evals (eval-stage.ts): throwaway repos, install, headless runs. */
import { spawnSync } from "node:child_process"
import * as fsSync from "node:fs"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const fixture = path.join(root, "test", "fixture-repo")

/** Feature folders go inside the workspace, where every tool's sandbox can write, but stay out of git. */
export const STATE_DIR = ".solodev-state"

export function sh(
  cmd: string,
  args: string[],
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
    timeout: opts.timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  })
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

export async function copyDir(from: string, to: string) {
  await fs.cp(from, to, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) })
}

export async function isDir(p: string): Promise<boolean> {
  return (await fs.stat(p).catch(() => undefined))?.isDirectory() ?? false
}

/** A fresh git repo: the fixture plus each existing seed folder, minus `remove`, committed on main. */
export async function workspace(name: string, seeds: string[] = [], remove: string[] = []): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), `solodev-eval-${name}-`))
  await copyDir(fixture, ws)
  for (const seed of seeds) if (await isDir(seed)) await copyDir(seed, ws)
  for (const f of remove) await fs.rm(path.join(ws, f), { recursive: true, force: true })
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "eval@example.com"],
    ["config", "user.name", "eval"],
    ["add", "-A"],
    ["commit", "-q", "-m", "chore: fixture"],
  ]) {
    sh("git", args, ws)
  }
  return ws
}

/** Installs solodev into the workspace (`local` from this checkout's dist/, or `ref:<tag>` through npx) and commits it. */
export function install(ws: string, source: string) {
  const env = { TARGET_DIR: ws, INSTALL_SCOPE: "project", INSTALL_TARGET: "all", CI: "1" }
  const r =
    source === "local"
      ? sh(process.execPath, [path.join(root, "bin", "install.js"), "--yes"], ws, {
          env: { ...env, LOCAL_SOURCE: root },
        })
      : sh("npx", ["-y", `github:luisintosh/solodev#${source.replace(/^ref:/, "")}`, "--yes"], ws, { env })
  if (r.code !== 0) throw new Error(`install of ${source} failed: ${r.stderr.slice(-500)}`)
  sh("git", ["add", "-A"], ws)
  sh("git", ["commit", "-q", "-m", "chore: install solodev"], ws)
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Claude Code prefers a user-level skill over a project one with the same name, so `~/.claude/skills/solodev-*` would
 * shadow the workspace's skills under test. Moves them to `~/.claude/solodev-eval-aside/<pid>/` for the run and returns
 * the restore, which also runs on exit and on SIGINT, SIGTERM or SIGHUP. A folder left by a killed run is restored first;
 * another live run holding the skills aside is an error, since its restore would unshadow this run midway.
 */
export function moveUserSkillsAside(home = os.homedir()): () => void {
  const skills = path.join(home, ".claude", "skills")
  const asideRoot = path.join(home, ".claude", "solodev-eval-aside")
  const list = (dir: string) => (fsSync.existsSync(dir) ? fsSync.readdirSync(dir) : [])
  const putBack = (from: string) => {
    fsSync.mkdirSync(skills, { recursive: true })
    for (const name of list(from)) {
      const to = path.join(skills, name)
      if (fsSync.existsSync(to))
        throw new Error(`can't restore ${path.join(from, name)}: ${to} exists; merge them by hand`)
      fsSync.renameSync(path.join(from, name), to)
    }
    fsSync.rmSync(from, { recursive: true, force: true })
  }

  for (const pid of list(asideRoot)) {
    if (alive(Number(pid))) throw new Error(`another eval run (pid ${pid}) has the user-level solodev skills aside`)
    putBack(path.join(asideRoot, pid))
    console.log(`eval: restored user-level skills left aside by run ${pid}`)
  }
  const names = list(skills).filter((n) => n.startsWith("solodev-"))
  if (!names.length) return () => {}

  const aside = path.join(asideRoot, String(process.pid))
  fsSync.mkdirSync(aside, { recursive: true })
  for (const name of names) fsSync.renameSync(path.join(skills, name), path.join(aside, name))
  console.log(`eval: moved ${names.length} user-level solodev skills aside for this run (${aside})`)

  const onSignal = (signal: NodeJS.Signals) => {
    restore()
    process.exit(128 + (os.constants.signals[signal] ?? 1))
  }
  const restore = () => {
    process.removeListener("exit", restore)
    for (const s of SIGNALS) process.removeListener(s, onSignal)
    if (!fsSync.existsSync(aside)) return
    putBack(aside)
    if (!list(asideRoot).length) fsSync.rmSync(asideRoot, { recursive: true, force: true })
    console.log("eval: restored the user-level solodev skills")
  }
  process.on("exit", restore)
  for (const s of SIGNALS) process.on(s, onSignal)
  return restore
}

/** The workspace's feature-folder root, kept out of git. */
export async function stateIn(ws: string): Promise<string> {
  await fs.appendFile(path.join(ws, ".git", "info", "exclude"), `${STATE_DIR}/\n`)
  return path.join(ws, STATE_DIR)
}

/**
 * Commands an unattended Claude Code run may use without asking: edits, plus the git, node and package-manager calls an
 * /solodev-mission run makes. Anything else is denied (headless mode has nobody to ask), instead of approving every command.
 */
export const CLAUDE_ALLOWED = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Agent",
  "Skill",
  "Bash(git:*)",
  "Bash(node:*)",
  "Bash(npm:*)",
  "Bash(npx:*)",
  "Bash(.agents/bin/solodev.mjs:*)",
]

export type Usage = { costUsd: number | null; inputTokens: number | null; outputTokens: number | null }

/** Cost and tokens from the last JSON line that reports them (Claude Code's `result`, Codex's usage events). */
export function usage(stdout: string): Usage {
  for (const line of stdout.trim().split("\n").reverse()) {
    try {
      const j = JSON.parse(line) as {
        total_cost_usd?: number
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      if (j.total_cost_usd !== undefined || j.usage) {
        return {
          costUsd: j.total_cost_usd ?? null,
          inputTokens: j.usage?.input_tokens ?? null,
          outputTokens: j.usage?.output_tokens ?? null,
        }
      }
    } catch {
      // not a JSON line
    }
  }
  return { costUsd: null, inputTokens: null, outputTokens: null }
}
