#!/usr/bin/env node
/** Install solodev into a repository (project) or $HOME (global). */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fsSync from "node:fs"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as p from "@clack/prompts"

const HOSTS = ["cursor", "claude", "codex"] as const
type Host = (typeof HOSTS)[number]
type Scope = "project" | "global"
type Manifest = Map<string, string>

const REPO_NAME = "solodev"

function log(message: string) {
  console.error(message)
}

function die(message: string): never {
  log(`ERROR: ${message}`)
  process.exit(1)
}

function onPath(...bins: string[]): boolean {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""]
  return bins.some((bin) => dirs.some((dir) => exts.some((ext) => fsSync.existsSync(path.join(dir, `${bin}${ext}`)))))
}

function detect(): Record<Host, boolean> {
  return {
    cursor: onPath("cursor", "cursor-agent"),
    claude: onPath("claude"),
    codex: onPath("codex"),
  }
}

function hostOnPath(host: Host): boolean {
  return detect()[host]
}

function fromPosix(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"))
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath)
  return createHash("sha256").update(buf).digest("hex")
}

function parseManifest(raw: string): Manifest {
  const map: Manifest = new Map()
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    const idx = line.indexOf("  ")
    if (idx < 0) continue
    map.set(line.slice(idx + 2), line.slice(0, idx))
  }
  return map
}

type CopyOp = {
  kind: "create" | "update" | "overwrite"
  label: string
  dest: string
  src: string
  chmod?: number
  localEdit: boolean
  extra?: string
}

type DeleteOp = {
  kind: "delete"
  label: string
  dest: string
  recursive?: boolean
  localEdit: boolean
  extra?: string
}

type FileOp = CopyOp | DeleteOp

type TreePlan = {
  prefix: string
  destRoot: string
  ops: FileOp[]
  skipped: number
  manifestBody: string
}

const WORKFLOW_BIN = "solodev.mjs"
// Installed to <root>/.agents/bin/.
const BINS = [WORKFLOW_BIN]

function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const manifest = path.join(dir, "manifest.txt")
    const distBin = path.join(dir, "dist", "bin", WORKFLOW_BIN)
    if (fsSync.existsSync(manifest) && fsSync.existsSync(distBin)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  die("could not find solodev payload (manifest.txt + dist/) — run pnpm run build in the toolkit checkout")
}

function requirePayload(src: string) {
  const ok =
    fsSync.existsSync(path.join(src, "manifest.txt")) &&
    fsSync.existsSync(path.join(src, "dist")) &&
    fsSync.existsSync(path.join(src, "dist", "bin", WORKFLOW_BIN))
  if (!ok) {
    die(
      `${src} is missing dist/ + manifest.txt — clients copy a committed payload (run pnpm run build in the toolkit checkout)`,
    )
  }
}

function normalizeTargets(raw: string): string {
  const target = raw.replaceAll(" ", "")
  if (!target) die("INSTALL_TARGET is empty")
  if (target === "all") return target
  for (const part of target.split(",")) {
    if (!(HOSTS as readonly string[]).includes(part)) {
      die(`invalid INSTALL_TARGET host: ${part} (use all or comma list: cursor,claude,codex)`)
    }
  }
  return target
}

function wantsHost(installTarget: string, host: Host): boolean {
  if (installTarget === "all") return true
  return `,${installTarget},`.includes(`,${host},`)
}

function abort(): never {
  p.cancel("Aborted")
  process.exit(1)
}

function shouldPrompt(scope: string, target: string): boolean {
  if (process.env.CI) return false
  if (scope || target) return false
  return Boolean(process.stdout.isTTY)
}

async function promptInteractive(targetDir: string): Promise<{ scope: Scope; target: string }> {
  const detected = detect()
  p.intro("solodev installer")

  const scope = await p.select({
    message: "Install where?",
    options: [
      { value: "project", label: "This repository", hint: targetDir },
      { value: "global", label: "User home (all repos)", hint: process.env.HOME },
    ],
    initialValue: "project",
  })
  if (p.isCancel(scope)) abort()

  const detectedHosts = HOSTS.filter((host) => detected[host])
  const targets = await p.multiselect({
    message: "Which hosts? Undetected ones can still be installed.",
    options: HOSTS.map((host) => ({
      value: host,
      label: host,
      hint: detected[host] ? "detected" : "not on PATH",
    })),
    initialValues: detectedHosts.length > 0 ? [...detectedHosts] : [...HOSTS],
    required: true,
  })
  if (p.isCancel(targets)) abort()

  return { scope: scope as Scope, target: targets.join(",") }
}

function parseArgs(argv: string[]): { dryRun: boolean; doctorOnly: boolean; yes: boolean } {
  let dryRun = false
  let doctorOnly = false
  let yes = false
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true
    else if (arg === "--doctor") doctorOnly = true
    else if (arg === "--yes") yes = true
  }
  return { dryRun, doctorOnly, yes }
}

function shouldConfirmApply(yes: boolean): boolean {
  if (yes) return false
  if (process.env.CI) return false
  return Boolean(process.stdout.isTTY)
}

function isGitRepo(dir: string): boolean {
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  return r.status === 0 && r.stdout.trim() === "true"
}

function ghStatus(): "ok" | "logged-out" | "missing" {
  if (!onPath("gh")) return "missing"
  const r = spawnSync("gh", ["auth", "status"], { stdio: "ignore" })
  return r.status === 0 ? "ok" : "logged-out"
}

function workflowBinInUse(targetDir: string, home: string): string | undefined {
  const project = path.join(targetDir, ".agents", "bin", WORKFLOW_BIN)
  const global = path.join(home, ".agents", "bin", WORKFLOW_BIN)
  if (fsSync.existsSync(project)) return project
  if (fsSync.existsSync(global)) return global
}

function resolveDests(scope: Scope, targetDir: string, home: string) {
  if (scope === "global") {
    return {
      agentsRoot: path.join(home, ".agents"),
      cursorAgents: path.join(home, ".cursor", "agents"),
      claudeAgents: path.join(home, ".claude", "agents"),
      claudeSkills: path.join(home, ".claude", "skills"),
      codexAgents: path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "agents"),
      legacyOpencode: path.join(home, ".config", "opencode", "agents"),
    }
  }
  return {
    agentsRoot: path.join(targetDir, ".agents"),
    cursorAgents: path.join(targetDir, ".cursor", "agents"),
    claudeAgents: path.join(targetDir, ".claude", "agents"),
    claudeSkills: path.join(targetDir, ".claude", "skills"),
    codexAgents: path.join(targetDir, ".codex", "agents"),
    legacyOpencode: path.join(targetDir, ".opencode"),
  }
}

function opLine(op: FileOp): string {
  let verb: string
  switch (op.kind) {
    case "create":
      verb = "+ create   "
      break
    case "update":
      verb = "~ update   "
      break
    case "overwrite":
      verb = "~ overwrite"
      break
    case "delete":
      verb = "- delete   "
      break
  }
  const warn = op.localEdit ? " (local edits will be lost)" : ""
  const extra = op.extra ? ` ${op.extra}` : ""
  return `  ${verb} ${op.label}${warn}${extra}`
}

function countKinds(ops: FileOp[]) {
  let created = 0
  let updated = 0
  let overwritten = 0
  let deleted = 0
  for (const op of ops) {
    if (op.kind === "create") created++
    else if (op.kind === "update") updated++
    else if (op.kind === "overwrite") overwritten++
    else deleted++
  }
  return { created, updated, overwritten, deleted }
}

function printTreePlan(plan: TreePlan) {
  for (const op of plan.ops) log(opLine(op))
  const { created, updated, overwritten, deleted } = countKinds(plan.ops)
  log(
    `  ${plan.prefix}: created ${created}, updated ${updated}, overwritten ${overwritten}, deleted ${deleted}, unchanged ${plan.skipped}.`,
  )
}

async function applyOp(op: FileOp): Promise<void> {
  if (op.kind === "delete") {
    await fs.rm(op.dest, { recursive: op.recursive === true, force: true })
    return
  }
  await fs.mkdir(path.dirname(op.dest), { recursive: true })
  await fs.copyFile(op.src, op.dest)
  if (op.chmod !== undefined) await fs.chmod(op.dest, op.chmod)
}

// Removes directories a delete left empty (e.g. a renamed skill's folder), up to destRoot.
async function pruneEmptyDirs(start: string, destRoot: string): Promise<void> {
  let dir = start
  while (dir.startsWith(`${destRoot}${path.sep}`)) {
    try {
      await fs.rmdir(dir)
    } catch {
      return
    }
    dir = path.dirname(dir)
  }
}

async function applyTree(plan: TreePlan): Promise<void> {
  for (const op of plan.ops) {
    await applyOp(op)
    if (op.kind === "delete") await pruneEmptyDirs(path.dirname(op.dest), plan.destRoot)
  }
  await fs.mkdir(plan.destRoot, { recursive: true })
  await fs.writeFile(path.join(plan.destRoot, ".harness-manifest"), plan.manifestBody)
}

async function confirmApply(ops: FileOp[]): Promise<void> {
  const n = ops.length
  const local = ops.filter((op) => op.localEdit).length
  const noun = n === 1 ? "change" : "changes"
  const message =
    local > 0
      ? `Apply ${n} ${noun}? ${local} file${local === 1 ? " has" : "s have"} local edits that will be lost.`
      : `Apply ${n} ${noun}?`
  const confirmed = await p.confirm({ message, initialValue: true })
  if (p.isCancel(confirmed) || !confirmed) abort()
}

async function planTree(opts: {
  prefix: string
  destRoot: string
  stageDir: string
  newManifest: Manifest
}): Promise<TreePlan> {
  const { prefix, destRoot, stageDir, newManifest } = opts
  const oldManifestPath = path.join(destRoot, ".harness-manifest")
  let oldManifest: Manifest = new Map()
  try {
    oldManifest = parseManifest(await fs.readFile(oldManifestPath, "utf8"))
  } catch {
    oldManifest = new Map()
  }

  const ops: FileOp[] = []
  let skipped = 0
  const prefixSlash = `${prefix}/`

  for (const relPath of newManifest.keys()) {
    if (!relPath.startsWith(prefixSlash)) continue
    const destRel = relPath.slice(prefixSlash.length)
    const dest = fromPosix(destRoot, destRel)
    const wantHash = newManifest.get(relPath) ?? ""
    const src = fromPosix(stageDir, relPath)
    const label = `${prefix}/${destRel}`

    if (!fsSync.existsSync(dest) || !fsSync.statSync(dest).isFile()) {
      ops.push({ kind: "create", label, dest, src, localEdit: false })
      continue
    }

    const haveHash = await sha256File(dest)
    if (haveHash === wantHash) {
      skipped++
      continue
    }

    const prevHash = oldManifest.get(destRel)
    if (prevHash && haveHash !== prevHash) {
      ops.push({ kind: "overwrite", label, dest, src, localEdit: true })
    } else {
      ops.push({ kind: "update", label, dest, src, localEdit: false })
    }
  }

  for (const destRel of oldManifest.keys()) {
    if (newManifest.has(`${prefix}/${destRel}`)) continue
    const dest = fromPosix(destRoot, destRel)
    if (!fsSync.existsSync(dest) || !fsSync.statSync(dest).isFile()) continue
    if (destRel === ".harness-manifest") continue

    const haveHash = await sha256File(dest)
    const prevHash = oldManifest.get(destRel)
    const localEdit = Boolean(prevHash && haveHash !== prevHash)
    ops.push({
      kind: "delete",
      label: `${prefix}/${destRel}`,
      dest,
      localEdit,
    })
  }

  const lines: string[] = []
  for (const relPath of newManifest.keys()) {
    if (!relPath.startsWith(prefixSlash)) continue
    const destRel = relPath.slice(prefixSlash.length)
    lines.push(`${newManifest.get(relPath)}  ${destRel}`)
  }
  lines.sort((a, b) => (a.split("  ")[1] ?? "").localeCompare(b.split("  ")[1] ?? ""))

  return {
    prefix,
    destRoot,
    ops,
    skipped,
    manifestBody: lines.length > 0 ? `${lines.join("\n")}\n` : "",
  }
}

async function planBin(opts: {
  scope: Scope
  targetDir: string
  home: string
  stageDir: string
  newManifest: Manifest
}): Promise<FileOp[]> {
  const destDir =
    opts.scope === "global" ? path.join(opts.home, ".agents", "bin") : path.join(opts.targetDir, ".agents", "bin")
  const ops: FileOp[] = []
  for (const bin of BINS) {
    const dest = path.join(destDir, bin)
    const src = path.join(opts.stageDir, "bin", bin)
    const wantHash = opts.newManifest.get(`bin/${bin}`)
    if (!wantHash) die(`manifest missing bin/${bin}`)
    const label = `.agents/bin/${bin}`
    if (!(fsSync.existsSync(dest) && (await sha256File(dest)) === wantHash)) {
      const kind = fsSync.existsSync(dest) ? "update" : "create"
      ops.push({ kind, label, dest, src, chmod: 0o755, localEdit: false })
    }
  }

  // The v1 state CLI and its older names; solodev.mjs replaces them.
  const leftovers = [
    path.join(destDir, "quest-state.mjs"),
    path.join(destDir, "quest-state"),
    path.join(destDir, "quest-state.js"),
    path.join(destDir, "sddkit-state.mjs"),
  ]
  if (opts.scope === "project") {
    leftovers.push(path.join(opts.targetDir, "bin", "quest-state"), path.join(opts.targetDir, "bin", "sdd-state"))
  }
  for (const leftover of leftovers) {
    if (!fsSync.existsSync(leftover)) continue
    const rel = leftover.startsWith(`${opts.targetDir}${path.sep}`)
      ? leftover.slice(opts.targetDir.length + 1)
      : leftover
    ops.push({
      kind: "delete",
      label: rel,
      dest: leftover,
      localEdit: false,
      extra: `(replaced by .agents/bin/${WORKFLOW_BIN})`,
    })
  }
  return ops
}

function planLegacyCursorSkills(scope: Scope, targetDir: string, home: string): FileOp[] {
  const dest = scope === "global" ? path.join(home, ".cursor", "skills") : path.join(targetDir, ".cursor", "skills")
  const ops: FileOp[] = []
  if (!fsSync.existsSync(dest)) return ops
  for (const name of ["sddkit", "sddkit-plan", "sddkit-epic", "sddkit-setup-docs", "setup-docs"]) {
    const pth = path.join(dest, name)
    if (!fsSync.existsSync(pth)) continue
    ops.push({
      kind: "delete",
      label: `.cursor/skills/${name}`,
      dest: pth,
      recursive: true,
      localEdit: false,
      extra: "(moved to .agents/skills/)",
    })
  }
  return ops
}

/**
 * v2 dropped OpenCode. A v1 install recorded every file it wrote in `.harness-manifest` under the OpenCode root; delete
 * exactly those (plus the manifest) and nothing the user added there.
 */
async function planLegacyOpencode(destRoot: string, label: string): Promise<FileOp[]> {
  const manifestPath = path.join(destRoot, ".harness-manifest")
  let listed: Manifest
  try {
    listed = parseManifest(await fs.readFile(manifestPath, "utf8"))
  } catch {
    return []
  }
  const ops: FileOp[] = []
  for (const [rel, hash] of listed) {
    const dest = fromPosix(destRoot, rel)
    if (!fsSync.existsSync(dest) || !fsSync.statSync(dest).isFile()) continue
    const localEdit = (await sha256File(dest)) !== hash
    ops.push({ kind: "delete", label: `${label}/${rel}`, dest, localEdit, extra: "(OpenCode support ended in v2)" })
  }
  ops.push({ kind: "delete", label: `${label}/.harness-manifest`, dest: manifestPath, localEdit: false })
  return ops
}

function doctor(targetDir: string, home: string) {
  log("")
  log("Doctor:")

  for (const host of HOSTS) {
    if (hostOnPath(host)) log(`  [ok]   ${host} CLI is on PATH`)
    else log(`  [warn] ${host} CLI not detected (install still allowed)`)
  }

  if (isGitRepo(targetDir)) log(`  [ok]   ${targetDir} is a git repository`)
  else log(`  [warn] ${targetDir} is not a git repository`)

  if (fsSync.existsSync(path.join(targetDir, "AGENTS.md"))) log("  [ok]   AGENTS.md present")
  else log("  [warn] AGENTS.md missing — run /arise-scout first")

  log("  paths:")
  log(`    skills          ${targetDir}/.agents/skills/  or  ${home}/.agents/skills/`)
  log(`    solodev CLI     ${targetDir}/.agents/bin/  or  ${home}/.agents/bin/`)
  log(`    cursor agents   ${targetDir}/.cursor/agents/  or  ${home}/.cursor/agents/`)
  log(`    claude agents   ${targetDir}/.claude/agents/  or  ${home}/.claude/agents/`)
  log(`    claude skills   ${targetDir}/.claude/skills/  or  ${home}/.claude/skills/`)
  log(`    codex agents    ${targetDir}/.codex/agents/  or  \${CODEX_HOME:-${home}/.codex}/agents/`)

  const bin = workflowBinInUse(targetDir, home)
  if (bin) log(`  [ok]   solodev CLI: ${bin}`)
  else log("  [warn] solodev CLI missing — re-run the installer")
  const skills = [path.join(targetDir, ".agents", "skills"), path.join(home, ".agents", "skills")]
  if (skills.some((dir) => fsSync.existsSync(path.join(dir, "arise", "SKILL.md"))))
    log("  [ok]   arise skills installed")
  else log("  [warn] arise skills missing — re-run the installer")

  if (onPath("node")) log("  [ok]   node is on PATH (needed to run the solodev CLI)")
  else log("  [warn] node not found — install Node.js 20+ to run the solodev CLI")

  const gh = ghStatus()
  if (gh === "ok") log("  [ok]   gh installed and authenticated")
  else if (gh === "logged-out") log("  [warn] gh installed but not logged in — run 'gh auth login'")
  else log("  [warn] gh not found — required by the pipeline: brew install gh && gh auth login")

  log("")
}

function suggestNextSteps() {
  log("Next steps:")
  log("  1. /arise-scout — write AGENTS.md (the commands list) + docs/ARCHITECTURE.md")
  if (!onPath("gh")) {
    log("  2. Install gh (required by the pipeline):")
    log("       brew install gh && gh auth login")
    log("       # or: https://cli.github.com/")
  } else {
    log("  2. gh is on PATH — run 'gh auth login' if you aren't logged in")
  }
  log("")
  log("Optional: /arise-strategist turns a raw idea into a feature roadmap at")
  log("  docs/product/<slug>/roadmap.md. Run each feature through /arise, one at")
  log("  a time; each run ends by naming the next one.")
  log("")
  log("Optional: rtk (filters noisy bash output for agents)")
  log("  brew install rtk   # or see https://github.com/rtk-ai/rtk")
  log("  # Quick start: exclude git diff/show from rewriting so the reviewer and")
  log("  # the documenter see full diffs — in ~/.config/rtk/config.toml:")
  log("  #   [hooks]")
  log('  #   exclude_commands = ["git diff", "git show"]')
  log("")
}

async function stagePayload(payloadDir: string): Promise<{ stageDir: string; manifest: Manifest; fileCount: number }> {
  const raw = await fs.readFile(path.join(payloadDir, "manifest.txt"), "utf8")
  if (!raw.trim()) die("manifest.txt is empty")
  const manifest = parseManifest(raw)
  const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "solodev-install-"))
  let fileCount = 0
  try {
    for (const [relPath, expectedHash] of manifest) {
      const src = fromPosix(path.join(payloadDir, "dist"), relPath)
      if (!fsSync.existsSync(src)) {
        await fs.rm(stageDir, { recursive: true, force: true })
        die(`missing ${path.join(payloadDir, "dist", relPath)}`)
      }
      const dest = fromPosix(stageDir, relPath)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.copyFile(src, dest)
      const actualHash = await sha256File(dest)
      if (actualHash !== expectedHash) {
        await fs.rm(stageDir, { recursive: true, force: true })
        die(`checksum mismatch for ${relPath} — aborting, nothing installed`)
      }
      fileCount++
    }
  } catch (err) {
    await fs.rm(stageDir, { recursive: true, force: true })
    throw err
  }
  return { stageDir, manifest, fileCount }
}

// Subcommands the packaged bin hands to the workflow CLI; no subcommand, `install`, or a flag runs the installer.
const WORKFLOW_COMMANDS = new Set(["probe", "status", "approve", "check", "help", "--help", "-h"])

function runWorkflow(argv: string[]): never {
  const bin = path.join(findPackageRoot(), "dist", "bin", WORKFLOW_BIN)
  const r = spawnSync(process.execPath, [bin, ...argv], { stdio: "inherit" })
  process.exit(r.status ?? 1)
}

async function main() {
  let argv = process.argv.slice(2)
  if (argv[0] && WORKFLOW_COMMANDS.has(argv[0])) runWorkflow(argv)
  if (argv[0] === "install") argv = argv.slice(1)
  const { dryRun, doctorOnly, yes } = parseArgs(argv)
  const targetDir = path.resolve(process.env.TARGET_DIR || process.cwd())
  const home = process.env.HOME || os.homedir()

  if (doctorOnly) {
    doctor(targetDir, home)
    return
  }

  if (!fsSync.existsSync(targetDir) || !fsSync.statSync(targetDir).isDirectory()) {
    die(`target directory does not exist: ${targetDir}`)
  }

  let scopeRaw = process.env.INSTALL_SCOPE ?? ""
  let targetRaw = process.env.INSTALL_TARGET ?? ""

  if (shouldPrompt(scopeRaw, targetRaw)) {
    const picked = await promptInteractive(targetDir)
    scopeRaw = picked.scope
    targetRaw = picked.target
  } else {
    if (!scopeRaw) scopeRaw = "project"
    if (!targetRaw) targetRaw = "all"
  }

  if (scopeRaw !== "project" && scopeRaw !== "global") {
    die(`invalid INSTALL_SCOPE: ${scopeRaw} (use project or global)`)
  }
  const scope: Scope = scopeRaw
  const installTarget = normalizeTargets(targetRaw)

  const localSource = process.env.LOCAL_SOURCE || ""
  let payloadDir: string
  if (localSource) {
    if (!fsSync.existsSync(localSource) || !fsSync.statSync(localSource).isDirectory()) {
      die(`LOCAL_SOURCE does not exist: ${localSource}`)
    }
    requirePayload(localSource)
    payloadDir = localSource
    log(`Installing from local source: ${localSource} (scope=${scope} target=${installTarget})`)
  } else {
    payloadDir = findPackageRoot()
    requirePayload(payloadDir)
    log(`Installing ${REPO_NAME} (scope=${scope} target=${installTarget})...`)
  }

  const { stageDir, manifest, fileCount } = await stagePayload(payloadDir)
  try {
    log(`Verified ${fileCount} files against manifest.txt`)

    const dests = resolveDests(scope, targetDir, home)
    const trees: TreePlan[] = [
      await planTree({
        prefix: "agents",
        destRoot: dests.agentsRoot,
        stageDir,
        newManifest: manifest,
      }),
    ]
    if (wantsHost(installTarget, "cursor")) {
      trees.push(
        await planTree({
          prefix: "cursor/agents",
          destRoot: dests.cursorAgents,
          stageDir,
          newManifest: manifest,
        }),
      )
    }
    if (wantsHost(installTarget, "claude")) {
      trees.push(
        await planTree({
          prefix: "claude/agents",
          destRoot: dests.claudeAgents,
          stageDir,
          newManifest: manifest,
        }),
      )
      trees.push(
        await planTree({
          prefix: "claude/skills",
          destRoot: dests.claudeSkills,
          stageDir,
          newManifest: manifest,
        }),
      )
    }
    if (wantsHost(installTarget, "codex")) {
      trees.push(
        await planTree({
          prefix: "codex/agents",
          destRoot: dests.codexAgents,
          stageDir,
          newManifest: manifest,
        }),
      )
    }

    const extraOps = [
      ...(await planBin({ scope, targetDir, home, stageDir, newManifest: manifest })),
      ...planLegacyCursorSkills(scope, targetDir, home),
      ...(await planLegacyOpencode(
        dests.legacyOpencode,
        scope === "global" ? "~/.config/opencode/agents" : ".opencode",
      )),
    ]

    for (const tree of trees) printTreePlan(tree)
    for (const op of extraOps) log(opLine(op))

    const allFileOps = [...trees.flatMap((tree) => tree.ops), ...extraOps]

    if (dryRun) {
      log("")
      log(`Dry run complete (scope=${scope} target=${installTarget}).`)
      return
    }

    if (allFileOps.length > 0 && shouldConfirmApply(yes)) {
      await confirmApply(allFileOps)
    }

    for (const tree of trees) await applyTree(tree)
    for (const op of extraOps) await applyOp(op)

    log("")
    log("Done. .agents/bin/solodev.mjs runs the workflow checks; `solodev.mjs help` lists its commands.")
    log("")
    suggestNextSteps()
    doctor(targetDir, home)
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true })
  }
}

await main()
