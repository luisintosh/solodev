#!/usr/bin/env node
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import catalog from "../catalog.yaml"
import { approve } from "./approve.ts"
import { CHECK_SETS, type CheckSet, formatResults, runChecks } from "./checks.ts"
import { formatCoders, parseCoderArgs, withCoder } from "./coder.ts"
import { run } from "./exec.ts"
import { exists, featureDir, SLUG } from "./feature.ts"
import { currentBranch } from "./git.ts"
import { HELP, helpText } from "./help.ts"
import {
  type AgentFiles,
  applyInit,
  formatInit,
  type InitOp,
  locate,
  planInit,
  type Scope,
  staleScopes,
} from "./init.ts"
import { isTool, modelsFromCatalog, TOOLS } from "./models.ts"
import { detectHome, parseDefaults, probe } from "./probe.ts"
import { proof } from "./proof.ts"
import { stateDir } from "./state.ts"
import { branchFeature, featureStatus, formatStatus, listFeatures, type Stage } from "./status.ts"

class UsageError extends Error {}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith("--")) throw new UsageError(`${name} needs a value`)
  return value
}

const BOOLEAN_FLAGS = ["--json", "--help", "--global", "--project", "--force", "--dry-run"]

function positional(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("--")) {
      if (!BOOLEAN_FLAGS.includes(args[i]!)) i++
      continue
    }
    out.push(args[i]!)
  }
  return out
}

async function repoRoot(): Promise<string> {
  if (process.env.SOLODEV_ROOT) return path.resolve(process.env.SOLODEV_ROOT)
  const r = await run("git", ["rev-parse", "--show-toplevel"])
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim()
  return process.cwd()
}

async function requireFeature(state: string, slug: string | undefined): Promise<string> {
  if (!slug) throw new UsageError("missing <slug>")
  if (!SLUG.test(slug)) throw new UsageError(`"${slug}" is not a feature slug (lowercase letters, digits, dashes)`)
  if (!(await exists(featureDir(state, slug)))) throw new UsageError(`${featureDir(state, slug)} does not exist`)
  return slug
}

const SET_FOR_STAGE: Partial<Record<Stage, CheckSet>> = {
  spec: "gate",
  gate: "gate",
  review: "pr",
  pr: "pr",
  qa: "done",
  done: "done",
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(helpText(command === "help" ? args[0] : undefined))
    return 0
  }
  if (!HELP[command]) throw new UsageError(`unknown command "${command}"`)
  if (args.includes("--help")) {
    console.log(helpText(command))
    return 0
  }
  if (command === "init") return init(args)
  if (command === "coder") return coder(args)
  const root = await repoRoot()
  const state = await stateDir(root, process.env, os.homedir())
  const models = modelsFromCatalog(catalog)
  const json = args.includes("--json")

  switch (command) {
    case "probe": {
      const result = await probe(
        {
          env: process.env,
          root,
          state,
          home: os.homedir(),
          exec: async (cmd, a) => {
            const r = await run(cmd, a, { cwd: root, timeoutMs: 15_000 })
            return { code: r.code, stdout: r.stdout }
          },
          which: async (bin) => (await run("sh", ["-c", `command -v ${bin}`])).code === 0,
          exists,
          read: (file) => fs.readFile(file, "utf8").catch(() => undefined),
          stale: async (tool) => {
            let agents: AgentFiles
            try {
              agents = await readShadows(await shippedShadowsDir())
            } catch {
              return []
            }
            const home = os.homedir()
            const read = (file: string) => fs.readFile(file, "utf8").catch(() => undefined)
            const base = { host: tool, home, env: process.env, agents, force: false, read }
            return staleScopes([
              { ...base, scope: "project", root, inside: await insideOf(root) },
              { ...base, scope: "global", root: home, inside: async () => true },
            ])
          },
          writable: async (dir) => {
            try {
              await fs.mkdir(dir, { recursive: true })
              const probeFile = path.join(dir, `.probe-${process.pid}`)
              await fs.writeFile(probeFile, "")
              await fs.rm(probeFile)
              return true
            } catch {
              return false
            }
          },
        },
        models,
      )
      console.log(JSON.stringify(result, null, 2))
      return 0
    }
    case "status": {
      const slug = positional(args)[0] ?? (await branchFeature(root, state))
      if (slug) {
        const feature = await requireFeature(state, slug)
        // The base is HEAD's fork point, so it's resolved only on the feature's own branch.
        const onBranch = (await currentBranch(root)) === `feat/${feature}`
        const status = await featureStatus(state, feature, onBranch ? root : undefined)
        console.log(json ? JSON.stringify(status, null, 2) : formatStatus(status))
        return 0
      }
      const slugs = await listFeatures(state)
      if (!slugs.length) {
        console.log(`no features in ${state} — start one with /solo-task`)
        return 0
      }
      const all = await Promise.all(slugs.map((s) => featureStatus(state, s)))
      if (json) console.log(JSON.stringify(all, null, 2))
      else for (const s of all) console.log(`${s.slug}: ${s.stage}`)
      return 0
    }
    case "approve": {
      const slug = await requireFeature(state, positional(args)[0])
      const approval = await approve({ root, dir: featureDir(state, slug) })
      console.log(`approved ${slug}: spec ${approval.spec} at ${approval.at}`)
      return 0
    }
    case "check": {
      const slug = await requireFeature(state, positional(args)[0])
      const forFlag = flag(args, "--for")
      if (forFlag && !(forFlag in CHECK_SETS)) throw new UsageError("--for must be gate, implement, pr or done")
      let set = forFlag as CheckSet | undefined
      if (!set) {
        const stage = (await featureStatus(state, slug)).stage
        set = SET_FOR_STAGE[stage] ?? "implement"
      }
      const results = await runChecks({ root, dir: featureDir(state, slug), set })
      if (json) console.log(JSON.stringify({ slug, set, results }, null, 2))
      else console.log(`solodev check ${slug} --for ${set}\n${formatResults(results)}`)
      return results.some((r) => r.status === "fail") ? 1 : 0
    }
    case "proof": {
      if (args.includes("--")) {
        throw new UsageError(
          `proof runs nothing: run the journey's command yourself, then record it: ${HELP.proof!.usage}`,
        )
      }
      const [slugArg, journeyArg, phase] = positional(args)
      const slug = await requireFeature(state, slugArg)
      if (!journeyArg || (phase !== "red" && phase !== "green")) throw new UsageError(`usage: ${HELP.proof!.usage}`)
      const journeys = journeyArg.split(",")
      if (journeys.some((j) => !j) || new Set(journeys).size !== journeys.length) {
        throw new UsageError(`journeys are a comma list with no empty or repeated id, as J1,J2 — got ${journeyArg}`)
      }
      const exit = flag(args, "--exit")
      if (exit === undefined || !/^\d+$/.test(exit)) throw new UsageError("--exit needs the command's exit code")
      const why = flag(args, "--why")
      if (!why?.trim()) {
        throw new UsageError(
          "--why needs the output line that shows the result: the failure for a red, the pass count for a green",
        )
      }
      const records = await proof({
        root,
        dir: featureDir(state, slug),
        journeys,
        phase,
        exit: Number(exit),
        output: why,
      })
      console.log(`recorded ${slug} ${journeys.join(", ")} ${phase} at tree ${records[0]!.tree}`)
      return 0
    }
    case "install":
      console.log(
        "Install or update the skills with `npx skills add luisintosh/solodev` (`-g` for every repo), then run\n" +
          "`/solo-task init` in each coding tool you use.",
      )
      return 0
  }
  return 0
}

/**
 * The shadows this skill ships in `shadows/<host>/`, as init writes them. Only the catalog's: an update that left an
 * older shadow behind in that folder doesn't bring it back.
 */
async function readShadows(dir: string): Promise<AgentFiles> {
  const names = new Set(Object.keys((catalog as { shadows?: Record<string, unknown> }).shadows ?? {}))
  const agents = {} as AgentFiles
  for (const host of TOOLS) {
    const files = (await fs.readdir(path.join(dir, host)).catch(() => [] as string[])).filter((file) =>
      names.has(file.replace(/\.(md|toml)$/, "")),
    )
    if (!files.length) throw new Error(`no shadows in ${path.join(dir, host)}; reinstall solodev`)
    agents[host] = {}
    for (const file of files.sort()) agents[host][file] = await fs.readFile(path.join(dir, host, file), "utf8")
  }
  return agents
}

const CONF = path.join(".agents", "solodev", "solodev-conf.yaml")

async function coder(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseCoderArgs>
  try {
    parsed = parseCoderArgs(positional(args))
  } catch (err) {
    throw new UsageError((err as Error).message)
  }
  const file = path.join(os.homedir(), CONF)
  let raw: string | undefined
  try {
    raw = await fs.readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`solodev coder: can't read ${file} (${(err as Error).message}); allow it in this tool's sandbox`)
      return 1
    }
  }
  const models = modelsFromCatalog(catalog)
  if (parsed.value === undefined) {
    const warnings: string[] = []
    const configured = parseDefaults(raw, warnings).coder
    console.log(`solodev coder (~/${CONF})\n${formatCoders(models, configured, parsed.tool)}`)
    for (const w of warnings) console.error(`warning: ${w}`)
    return 0
  }
  const tool = parsed.tool ?? detectHome(process.env)
  if (!tool)
    throw new UsageError("couldn't tell which coding tool runs this session; name it: solodev coder claude <value>")
  const next = withCoder(raw, tool, parsed.value)
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, next)
  } catch (err) {
    console.error(`solodev coder: can't write ${file} (${(err as Error).message}); allow it in this tool's sandbox`)
    return 1
  }
  const now = parsed.value === "default" ? `${models[tool].coder} (default)` : parsed.value
  console.log(`${tool} coder: ${now}. It applies from the next /solo-task run.`)
  return 0
}

/** The `shadows/` folder beside this CLI, as the skill ships it. */
async function shippedShadowsDir(): Promise<string> {
  return path.join(path.dirname(await fs.realpath(fileURLToPath(import.meta.url))), "..", "shadows")
}

async function init(args: string[]): Promise<number> {
  const named = positional(args)[0]
  if (named && !isTool(named)) throw new UsageError(`unknown tool "${named}" (claude, codex or cursor)`)
  const host = named ?? detectHome(process.env)
  if (!host) throw new UsageError("couldn't tell which coding tool runs this session; name it: solodev init claude")
  if (args.includes("--global") && args.includes("--project")) throw new UsageError("pick --global or --project")
  const home = os.homedir()
  // Both real paths: the CLI's is resolved through symlinks (npx skills links agent folders), so $HOME must be too.
  const realHome = await fs.realpath(home).catch(() => home)
  const cliPath = await fs.realpath(fileURLToPath(import.meta.url))
  const located = locate(cliPath, realHome, process.env)
  const scope: Scope = args.includes("--global")
    ? "global"
    : args.includes("--project")
      ? "project"
      : (located?.scope ?? "project")
  const root = scope === "global" ? home : located?.scope === "project" ? located.base : await repoRoot()
  const dryRun = args.includes("--dry-run")
  const input = {
    host,
    scope,
    root,
    home,
    env: process.env,
    agents: await readShadows(await shippedShadowsDir()),
    force: args.includes("--force"),
    read: (file: string) => fs.readFile(file, "utf8").catch(() => undefined),
    inside: scope === "global" ? async () => true : await insideOf(root),
  }
  const ops = await planInit(input)
  if (!dryRun) {
    // Write beside the file, then rename over it: a symlink in its place is replaced, never written through.
    await applyInit(
      ops,
      async (file, content) => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`)
        await fs.writeFile(tmp, content, { flag: "wx" })
        await fs.rename(tmp, file)
      },
      (file) => fs.rm(file, { force: true }),
    )
  }
  const edited = ops.filter((op): op is Extract<InitOp, { kind: "edited" }> => op.kind === "edited")
  const failed = edited.length > 0 || ops.some((op) => op.kind === "outside")
  if (args.includes("--json")) {
    console.log(JSON.stringify({ host, scope, root, dryRun, ops }, null, 2))
    return failed ? 1 : 0
  }
  console.log(formatInit(input, ops, dryRun))
  for (const op of edited) console.log(`\n${await diff(op.path, op.content)}`)
  return failed ? 1 : 0
}

/** Whether a path's nearest existing folder resolves, through symlinks, inside `root`. */
async function insideOf(root: string): Promise<(file: string) => Promise<boolean>> {
  const real = await fs.realpath(root)
  return async (file) => {
    let dir = path.dirname(file)
    for (;;) {
      const resolved = await fs.realpath(dir).catch(() => undefined)
      if (resolved !== undefined) return resolved === real || resolved.startsWith(`${real}${path.sep}`)
      const up = path.dirname(dir)
      if (up === dir) return false
      dir = up
    }
  }
}

/** What --force would change in an edited shadow. */
async function diff(file: string, content: string): Promise<string> {
  const tmp = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "solodev-init-")), path.basename(file))
  await fs.writeFile(tmp, content)
  const r = await run("git", ["diff", "--no-index", "--no-color", "--", file, tmp])
  await fs.rm(path.dirname(tmp), { recursive: true, force: true })
  return r.stdout.trim() || `${file} differs from what init writes`
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (err) {
  console.error(`solodev: ${(err as Error).message}`)
  if (err instanceof UsageError) console.error("Run `solodev help` for usage.")
  process.exitCode = err instanceof UsageError ? 2 : 1
}
