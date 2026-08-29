#!/usr/bin/env node
/**
 * Hygiene checks (run after `pnpm run build`):
 *   1. catalog.yaml shape, pinned models, and a prompt file per skill and shadow
 *   2. prompt rules: skill line budgets, no capitalized MUST/NEVER/CRITICAL/ALWAYS, required phrases
 *   3. dist/ skills, references and shadow frontmatter match the catalog
 *   4. README profile × host matrix and shadow table match the catalog
 *   5. manifest.txt matches dist/ hashes
 *   6. bin/install.js (npx/bunx CLI) is present and not stale
 */
import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { readdir, readFile, rm, stat } from "node:fs/promises"
import * as os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
import { DISPLAY, formatCodexModel, formatCursorModel, GOLDEN_MODELS, HOSTS, PROFILE_NAMES } from "./models.ts"
import { run } from "./sh.ts"
import { type Catalog, renderPrompt, skillReferences } from "./transpile.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const errors: string[] = []

function fail(msg: string) {
  errors.push(msg)
}

async function sha256(filePath: string) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
}

async function walkFiles(dir: string) {
  const out: string[] = []
  async function walk(d: string) {
    let entries: Dirent[]
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) out.push(p)
    }
  }
  await walk(dir)
  return out.sort()
}

const readOr = (file: string) => readFile(file, "utf8").catch(() => undefined)

function frontmatter(raw: string | undefined): Record<string, unknown> | undefined {
  const m = raw?.match(/^---\n([\s\S]*?)\n---\n/)
  return m ? (parseYaml(m[1]!) as Record<string, unknown>) : undefined
}

/** Every permission value in a nested map, flattened to "path -> value" pairs. */
function permissionValues(node: unknown, at: string[] = []): [string, string][] {
  if (typeof node === "string") return [[at.join("."), node]]
  if (!node || typeof node !== "object" || Array.isArray(node)) return []
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => permissionValues(v, [...at, k]))
}

const SHADOWS = ["shadow-coder", "shadow-reviewer"]
const SKILLS = [
  "solodev-mission",
  "solodev-plan",
  "solodev-code",
  "solodev-review",
  "solodev-verify",
  "solodev-roadmap",
  "solodev-scout",
]
/** Claude Code ignores any other `experimental.cacheTtl`, so a typo would silently fall back to the 5m default. */
const CACHE_TTLS = new Set(["5m", "1h"])
/** Top models over-trigger on shouted rules; write "do X when Y" instead. */
const SHOUTED = /\b(MUST|NEVER|CRITICAL|ALWAYS)\b/

let catalog: Catalog | undefined
try {
  catalog = parseYaml(await readFile(path.join(root, "src", "catalog.yaml"), "utf8")) as Catalog
} catch (err) {
  fail(`src/catalog.yaml: failed to parse — ${(err as Error).message}`)
}

// 1. Catalog shape.
if (catalog) {
  const hosts = Object.keys(catalog.hosts ?? {})
  if (hosts.sort().join() !== [...HOSTS].sort().join()) fail(`catalog: hosts must be ${HOSTS.join(", ")}`)
  for (const host of HOSTS) {
    for (const profile of PROFILE_NAMES) {
      const ref = catalog.hosts?.[host]?.profiles?.[profile]
      if (!ref?.id) {
        fail(`catalog: hosts.${host}.profiles.${profile} required`)
        continue
      }
      const shown = DISPLAY[host](ref)
      if (shown !== GOLDEN_MODELS[host][profile]) {
        fail(`catalog: ${host} ${profile} is ${shown}, golden ${GOLDEN_MODELS[host][profile]} — update tools/models.ts`)
      }
    }
    for (const profile of Object.keys(catalog.hosts?.[host]?.profiles ?? {})) {
      if (!(PROFILE_NAMES as readonly string[]).includes(profile))
        fail(`catalog: hosts.${host}.profiles.${profile} unknown`)
    }
  }

  const shadows = Object.keys(catalog.shadows ?? {})
  if (shadows.sort().join() !== [...SHADOWS].sort().join()) fail(`catalog: shadows must be ${SHADOWS.join(", ")}`)
  for (const [name, shadow] of Object.entries(catalog.shadows ?? {})) {
    if (!shadow.description?.trim()) fail(`catalog: shadows.${name}.description required`)
    if (!(PROFILE_NAMES as readonly string[]).includes(shadow.profile)) {
      fail(`catalog: shadows.${name}.profile must be ${PROFILE_NAMES.join(" or ")}`)
    }
    for (const skill of shadow.skills ?? []) {
      if (!catalog.skills?.[skill]) fail(`catalog: shadows.${name} plays ${skill}, which is not a skill`)
    }
    for (const key of Object.keys(shadow.permission ?? {})) {
      if (key !== "edit")
        fail(`catalog: shadows.${name}.permission.${key} — only edit denies; say the rest in a prompt`)
    }
    for (const [where, value] of permissionValues(shadow.permission)) {
      if (value !== "deny") fail(`catalog: shadows.${name}.permission "${where}" is "${value}" — only deny is rendered`)
    }
    const ttl = shadow.claude?.cache_ttl
    if (ttl !== undefined && !CACHE_TTLS.has(ttl)) fail(`catalog: shadows.${name}.claude.cache_ttl must be 5m or 1h`)
    if (!(await readOr(path.join(root, "src", "prompts", "agents", `${name}.md`)))) {
      fail(`src/prompts/agents/${name}.md missing`)
    }
  }
  for (const file of await readdir(path.join(root, "src", "prompts", "agents")).catch(() => [] as string[])) {
    if (!catalog.shadows?.[file.replace(/\.md$/, "")]) fail(`src/prompts/agents/${file} has no catalog shadow`)
  }

  const skills = Object.keys(catalog.skills ?? {})
  if (skills.sort().join() !== [...SKILLS].sort().join()) fail(`catalog: skills must be ${SKILLS.join(", ")}`)
  for (const dir of await readdir(path.join(root, "src", "prompts", "skills")).catch(() => [] as string[])) {
    if (!catalog.skills?.[dir]) fail(`src/prompts/skills/${dir} has no catalog skill`)
  }
}

// 2. Prompt rules, on the rendered source (includes resolved).
if (catalog) {
  const contracts: Record<string, string[]> = {
    "solodev-mission": ["`/plan`", "solodev approve", "solodev check", "never merge"],
    "solodev-plan": ["journeys:", "uncovered", "@S1"],
    "solodev-code": [
      "solodev check <slug> --for implement",
      "fails because the behavior is missing",
      "references/docs.md",
    ],
    "solodev-review": ["review.md", "deferred", "rebutted"],
    "solodev-verify": ["qa.md", "agent-browser"],
    "solodev-scout": ["## Commands", "test_file"],
  }
  for (const [name, skill] of Object.entries(catalog.skills ?? {})) {
    let body: string
    try {
      body = await renderPrompt(`skills/${name}/SKILL.md`)
    } catch (err) {
      fail(`src/prompts/skills/${name}/SKILL.md: ${(err as Error).message}`)
      continue
    }
    if (!skill.description?.trim()) fail(`catalog: skills.${name}.description required`)
    const lines = body.trimEnd().split("\n").length
    if (typeof skill.budget !== "number") fail(`catalog: skills.${name}.budget required`)
    else if (lines > skill.budget) fail(`skills/${name}/SKILL.md is ${lines} lines, over its budget of ${skill.budget}`)
    if (skill.profile && !(PROFILE_NAMES as readonly string[]).includes(skill.profile)) {
      fail(`catalog: skills.${name}.profile must be ${PROFILE_NAMES.join(" or ")}`)
    }
    for (const phrase of contracts[name] ?? []) {
      if (!body.includes(phrase)) fail(`skills/${name}/SKILL.md: required phrase missing: "${phrase}"`)
    }
    const refs = await skillReferences(name)
    for (const m of body.matchAll(/\]\(references\/([\w.-]+)\)/g)) {
      if (!refs.includes(m[1]!)) fail(`skills/${name}/SKILL.md links references/${m[1]}, which does not exist`)
    }
    for (const ref of refs) {
      if (!body.includes(`references/${ref}`)) fail(`skills/${name}/references/${ref} is never linked from SKILL.md`)
    }
  }
  for (const file of await walkFiles(path.join(root, "src", "prompts"))) {
    const text = await readFile(file, "utf8")
    text.split("\n").forEach((line, i) => {
      const m = line.match(SHOUTED)
      if (m) fail(`${path.relative(root, file)}:${i + 1}: capitalized "${m[1]}" — state the rule plainly`)
    })
  }
}

// 3. dist matches the catalog.
if (catalog) {
  for (const [name, skill] of Object.entries(catalog.skills ?? {})) {
    for (const tree of ["agents", "claude"]) {
      const file = path.join(root, "dist", tree, "skills", name, "SKILL.md")
      const raw = await readOr(file)
      const fm = frontmatter(raw)
      if (!raw || !fm) {
        fail(`dist/${tree}/skills/${name}/SKILL.md missing — run pnpm run build`)
        continue
      }
      if (fm.name !== name) fail(`dist/${tree}/skills/${name}/SKILL.md: name ${fm.name}`)
      if (Boolean(fm["disable-model-invocation"]) !== Boolean(skill.user_only)) {
        fail(`dist drift: ${tree} skill ${name} disable-model-invocation — run pnpm run build`)
      }
      const want = tree === "claude" && skill.profile ? catalog.hosts.claude.profiles[skill.profile] : undefined
      if (fm.model !== want?.id || fm.effort !== want?.effort) {
        fail(`dist drift: ${tree} skill ${name} model ${fm.model}/${fm.effort} — run pnpm run build`)
      }
      if (raw.includes("{{")) fail(`dist/${tree}/skills/${name}/SKILL.md: unresolved {{…}} placeholder`)
      for (const ref of await skillReferences(name)) {
        const text = await readOr(path.join(root, "dist", tree, "skills", name, "references", ref))
        if (text === undefined) fail(`dist/${tree}/skills/${name}/references/${ref} missing — run pnpm run build`)
        else if (text.includes("{{")) fail(`dist/${tree}/skills/${name}/references/${ref}: unresolved placeholder`)
      }
    }
  }
  for (const [name, shadow] of Object.entries(catalog.shadows ?? {})) {
    const claudeFm = frontmatter(await readOr(path.join(root, "dist", "claude", "agents", `${name}.md`)))
    const claudeRef = catalog.hosts.claude.profiles[shadow.profile]
    if (!claudeFm) fail(`dist/claude/agents/${name}.md missing — run pnpm run build`)
    else {
      if (claudeFm.model !== claudeRef?.id || claudeFm.effort !== claudeRef?.effort) {
        fail(`dist drift: claude ${name} model — run pnpm run build`)
      }
      if (JSON.stringify(claudeFm.skills) !== JSON.stringify(shadow.skills)) {
        fail(`dist drift: claude ${name} skills — run pnpm run build`)
      }
      const ttl = (claudeFm.experimental as { cacheTtl?: string } | undefined)?.cacheTtl
      if (ttl !== shadow.claude?.cache_ttl)
        fail(`dist drift: claude ${name} experimental.cacheTtl — run pnpm run build`)
    }
    const cursorFm = frontmatter(await readOr(path.join(root, "dist", "cursor", "agents", `${name}.md`)))
    const cursorRef = catalog.hosts.cursor.profiles[shadow.profile]
    if (!cursorFm) fail(`dist/cursor/agents/${name}.md missing — run pnpm run build`)
    else if (cursorRef && cursorFm.model !== formatCursorModel(cursorRef)) {
      fail(`dist drift: cursor ${name} model ${cursorFm.model} — run pnpm run build`)
    }
    const toml = await readOr(path.join(root, "dist", "codex", "agents", `${name}.toml`))
    const codexRef = catalog.hosts.codex.profiles[shadow.profile]
    if (!toml) fail(`dist/codex/agents/${name}.toml missing — run pnpm run build`)
    else if (codexRef) {
      const want = formatCodexModel(codexRef)
      if (toml.match(/^model = "(.*)"$/m)?.[1] !== want.model)
        fail(`dist drift: codex ${name} model — run pnpm run build`)
      if (toml.match(/^model_reasoning_effort = "(.*)"$/m)?.[1] !== want.reasoning) {
        fail(`dist drift: codex ${name} model_reasoning_effort — run pnpm run build`)
      }
    }
  }
}

const solodevBin = await readOr(path.join(root, "dist", "bin", "solodev-cli.mjs"))
if (!solodevBin) fail("dist/bin/solodev-cli.mjs missing — run pnpm run build")
else if (!solodevBin.startsWith("#!/usr/bin/env node\n")) fail("dist/bin/solodev-cli.mjs missing node shebang")
for (const stale of ["quest-state.mjs", "quest-state", "quest-state.js"]) {
  if (await stat(path.join(root, "dist", "bin", stale)).catch(() => undefined)) {
    fail(`dist/bin/${stale} is the v1 state CLI — delete it`)
  }
}

// 4. README tables.
const readme = await readFile(path.join(root, "README.md"), "utf8")
const modelsSection = readme.split("## Models")[1]?.split(/^## /m)[0] ?? ""
const readmeProfiles = new Map<string, Record<string, string>>()
const readmeShadows = new Map<string, string>()
for (const m of modelsSection.matchAll(/^\|\s*`([a-z-]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) {
  readmeProfiles.set(m[1]!, { claude: m[2]!, codex: m[3]!, cursor: m[4]! })
}
for (const m of modelsSection.matchAll(/^\|\s*`([a-z-]+)`\s*\|\s*`([a-z]+)`\s*\|\s*$/gm)) {
  readmeShadows.set(m[1]!, m[2]!)
}
if (catalog) {
  for (const profile of PROFILE_NAMES) {
    const row = readmeProfiles.get(profile)
    if (!row) {
      fail(`README.md: ## Models matrix has no row for \`${profile}\` (columns: Claude Code, Codex, Cursor)`)
      continue
    }
    for (const host of HOSTS) {
      const want = DISPLAY[host](catalog.hosts[host].profiles[profile]!)
      if (row[host] !== want) fail(`README.md: ${profile} ${host} is ${row[host]}, catalog ${want}`)
    }
  }
  for (const profile of readmeProfiles.keys()) {
    if (!(PROFILE_NAMES as readonly string[]).includes(profile)) fail(`README.md: matrix lists unknown "${profile}"`)
  }
  const roles: Record<string, string> = Object.fromEntries(
    Object.entries(catalog.shadows ?? {}).map(([n, s]) => [n, s.profile]),
  )
  for (const [name, profile] of Object.entries(roles)) {
    if (readmeShadows.get(name) !== profile) fail(`README.md: shadow table needs | \`${name}\` | \`${profile}\` |`)
  }
  for (const name of readmeShadows.keys()) if (!roles[name]) fail(`README.md: shadow table lists unknown "${name}"`)
}

// 5. manifest.txt.
async function expectedManifestEntries() {
  const files = [
    ...(await walkFiles(path.join(root, "dist", "cursor"))),
    ...(await walkFiles(path.join(root, "dist", "claude"))),
    ...(await walkFiles(path.join(root, "dist", "codex"))),
    ...(await walkFiles(path.join(root, "dist", "agents"))),
    path.join(root, "dist", "bin", "solodev-cli.mjs"),
  ]
  const entries: [string, string][] = []
  for (const abs of files.sort()) {
    entries.push([await sha256(abs), path.relative(path.join(root, "dist"), abs).split(path.sep).join("/")])
  }
  return entries
}

const manifestRaw = await readOr(path.join(root, "manifest.txt"))
if (manifestRaw === undefined) {
  fail("manifest.txt: missing — run pnpm run build")
} else {
  const actual = new Map<string, string>()
  for (const line of manifestRaw.trim().split("\n").filter(Boolean)) {
    const m = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/)
    if (!m) fail(`manifest.txt: malformed line "${line}"`)
    else actual.set(m[2]!, m[1]!)
  }
  const expected = new Map((await expectedManifestEntries()).map(([hash, rel]) => [rel, hash]))
  for (const [rel, hash] of expected) {
    if (!actual.has(rel)) fail(`manifest.txt: missing ${rel} — run pnpm run build`)
    else if (actual.get(rel) !== hash) fail(`manifest.txt: stale hash for ${rel} — run pnpm run build`)
  }
  for (const rel of actual.keys()) if (!expected.has(rel)) fail(`manifest.txt: lists ${rel}, which isn't installed`)
}

// 6. bin/install.js.
{
  const current = await readOr(path.join(root, "bin", "install.js"))
  if (current === undefined) fail("bin/install.js missing — run pnpm run build")
  else {
    if (!current.startsWith("#!/usr/bin/env node\n")) fail("bin/install.js missing node shebang — run pnpm run build")
    const tmp = path.join(os.tmpdir(), `solodev-install-check-${process.pid}.js`)
    try {
      await run(process.execPath, [path.join(root, "tools", "build-install.ts"), "--outfile", tmp])
      if (current !== (await readFile(tmp, "utf8"))) fail("bin/install.js stale — run pnpm run build")
    } catch {
      fail("bin/install.js rebuild failed — run pnpm run build")
    } finally {
      await rm(tmp, { force: true })
    }
  }
}

if (errors.length > 0) {
  console.error(`check: ${errors.length} problem(s) found\n`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log(
  `check: ok (${Object.keys(catalog?.skills ?? {}).length} skills, ${Object.keys(catalog?.shadows ?? {}).length} shadows, ${readmeProfiles.size} profile rows, manifest fresh)`,
)
