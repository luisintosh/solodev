#!/usr/bin/env node
/**
 * Hygiene checks (run after `pnpm run build`):
 *   1. catalog.yaml shape, pinned models, and a prompt file per skill and shadow
 *   2. prompt rules: skill line budgets, no capitalized MUST/NEVER/CRITICAL/ALWAYS, required phrases
 *   3. dist/product skills and references, and dist/ shadow frontmatter, match the catalog
 *   4. README profile × host matrix and shadow table match the catalog
 *   5. dist/product holds only what master ships, its `shadows/` holds exactly the built shadows, and its CLI's `init`
 *      writes them
 */
import type { Dirent } from "node:fs"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import * as os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
import { DISPLAY, formatCodexModel, formatCursorModel, GOLDEN_MODELS, HOSTS, PROFILE_NAMES } from "./models.ts"
import { run } from "./sh.ts"
import { stripHash } from "../src/cli/init.ts"
import { type Catalog, PRODUCT_EXTRAS, renderPrompt, skillReferences } from "./transpile.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const errors: string[] = []

function fail(msg: string) {
  errors.push(msg)
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
/** A prompt with its line wrapping undone, so a required phrase may span lines. */
const flat = (text: string) => text.replace(/\s+/g, " ")
if (catalog) {
  const contracts: Record<string, string[]> = {
    "solodev-mission": [
      "`/plan`",
      "solodev approve",
      "solodev check",
      "never merge",
      "code before that line",
      "never push to the default branch",
      "start lens reviewers together",
    ],
    "solodev-plan": ["journeys:", "uncovered", "@S1"],
    "solodev-code": [
      "solodev check <slug> --for implement",
      "fails because the behavior is missing",
      "references/docs.md",
    ],
    "solodev-review": ["review.md", "deferred", "rebutted", "lens: single", "Weakened test:", "as you found it"],
    "solodev-verify": ["## QA", "agent-browser"],
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
    for (const phrase of contracts[name] ?? []) {
      if (!flat(body).includes(phrase)) fail(`skills/${name}/SKILL.md: required phrase missing: "${phrase}"`)
    }
    const refs = await skillReferences(name)
    for (const m of body.matchAll(/\]\(references\/([\w.-]+)\)/g)) {
      if (!refs.includes(m[1]!)) fail(`skills/${name}/SKILL.md links references/${m[1]}, which does not exist`)
    }
    for (const ref of refs) {
      if (!body.includes(`references/${ref}`)) fail(`skills/${name}/references/${ref} is never linked from SKILL.md`)
    }
  }
  // Rules a reference has to keep, on the rendered reference.
  const referenceContracts: Record<string, string[]> = {
    "solodev-review/references/swarm.md": [
      "all started in the same turn",
      "When unsure, go parallel",
      "merge without it",
      "an open security row makes it sensitive",
      "Evidence runs every time",
      "stays `open` if either says so",
    ],
  }
  for (const [ref, phrases] of Object.entries(referenceContracts)) {
    const body = await renderPrompt(`skills/${ref}`).catch(() => "")
    if (!body) fail(`skills/${ref} is missing`)
    for (const phrase of phrases) {
      if (body && !flat(body).includes(phrase)) fail(`skills/${ref}: required phrase missing: "${phrase}"`)
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
    const rel = `dist/product/skills/${name}`
    const raw = await readOr(path.join(root, rel, "SKILL.md"))
    const fm = frontmatter(raw)
    if (!raw || !fm) {
      fail(`${rel}/SKILL.md missing — run pnpm run build`)
      continue
    }
    if (fm.name !== name) fail(`${rel}/SKILL.md: name ${fm.name}`)
    if (Boolean(fm["disable-model-invocation"]) !== Boolean(skill.user_only)) {
      fail(`dist drift: skill ${name} disable-model-invocation — run pnpm run build`)
    }
    if (fm.model !== undefined || fm.effort !== undefined) fail(`${rel}/SKILL.md: skills carry no model or effort`)
    if (raw.includes("{{")) fail(`${rel}/SKILL.md: unresolved {{…}} placeholder`)
    for (const ref of await skillReferences(name)) {
      const text = await readOr(path.join(root, rel, "references", ref))
      if (text === undefined) fail(`${rel}/references/${ref} missing — run pnpm run build`)
      else if (text.includes("{{")) fail(`${rel}/references/${ref}: unresolved placeholder`)
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

// 5. dist/product is exactly what master ships, and its CLI writes the built shadows.
const product = path.join(root, "dist", "product")
const shipped = (await readdir(product).catch(() => [] as string[])).sort()
const wantShipped = ["skills", ...PRODUCT_EXTRAS].sort()
if (JSON.stringify(shipped) !== JSON.stringify(wantShipped)) {
  fail(`dist/product holds ${shipped.join(", ") || "nothing"}, expected ${wantShipped.join(", ")} — run pnpm run build`)
}
for (const host of HOSTS) {
  const want = (await readdir(path.join(root, "dist", host, "agents")).catch(() => [] as string[])).sort()
  const have = (
    await readdir(path.join(product, "skills", "solodev-mission", "shadows", host)).catch(() => [] as string[])
  ).sort()
  if (!want.length || JSON.stringify(have) !== JSON.stringify(want)) {
    fail(`dist/product/skills/solodev-mission/shadows/${host} doesn't match dist/${host}/agents — run pnpm run build`)
  }
}
const cliPath = path.join(product, "skills", "solodev-mission", "scripts", "solodev-cli.mjs")
const cli = await readOr(cliPath)
if (!cli) fail("dist/product/skills/solodev-mission/scripts/solodev-cli.mjs missing — run pnpm run build")
else if (!cli.startsWith("#!/usr/bin/env node\n")) fail("solodev-cli.mjs missing node shebang")
else if (catalog) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "solodev-check-"))
  try {
    for (const host of HOSTS) {
      const out = await run(process.execPath, [cliPath, "init", host, "--project", "--dry-run", "--json"], tmp, {
        SOLODEV_ROOT: tmp,
      })
      const report = JSON.parse(out) as { ops: { kind: string; path: string; content?: string }[] }
      for (const name of Object.keys(catalog.shadows ?? {})) {
        const file = `${name}.${host === "codex" ? "toml" : "md"}`
        const op = report.ops.find((o) => o.path.endsWith(`${path.sep}${file}`))
        const built = await readOr(path.join(root, "dist", host, "agents", file))
        if (!op?.content || !built || stripHash(op.content) !== built) {
          fail(`solodev-cli.mjs init ${host}: ${file} doesn't match dist/${host}/agents — run pnpm run build`)
        }
      }
    }
  } catch (err) {
    fail(`solodev-cli.mjs init --dry-run failed: ${(err as Error).message}`)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

if (errors.length > 0) {
  console.error(`check: ${errors.length} problem(s) found\n`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log(
  `check: ok (${Object.keys(catalog?.skills ?? {}).length} skills, ${Object.keys(catalog?.shadows ?? {}).length} shadows, ${readmeProfiles.size} profile rows, CLI shadows fresh)`,
)
