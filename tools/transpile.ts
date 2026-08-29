#!/usr/bin/env node
/**
 * Emit the role skills (dist/agents/skills for Codex and Cursor, dist/claude/skills for Claude Code) and the two shadow
 * agents per host (dist/claude/agents, dist/cursor/agents, dist/codex/agents).
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { formatCodexModel, formatCursorModel, type Host, type ModelRef } from "./models.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = path.join(root, "src")
const promptsDir = path.join(srcDir, "prompts")
const distDir = path.join(root, "dist")

/** Hard edit denies only: a map of path pattern → "deny", or a bare "deny" for no edits at all. */
type Permission = { edit?: unknown }

export type Shadow = {
  profile: string
  /** Role skills this shadow plays; Claude Code preloads them. */
  skills: string[]
  description: string
  permission?: Permission
  claude?: {
    /** Only for a shadow the commander continues: a longer TTL costs 2x per write and pays off only on reuse. */
    cache_ttl?: "5m" | "1h"
  }
}

export type Skill = {
  budget: number
  description: string
  /** Claude Code runs the skill on this profile's model. */
  profile?: string
  /** Invoked by the user only; hosts don't load it on their own. */
  user_only?: boolean
}

export type Catalog = {
  hosts: Record<Host, { profiles: Record<string, ModelRef> }>
  shadows: Record<string, Shadow>
  skills: Record<string, Skill>
}

export async function loadCatalog(): Promise<Catalog> {
  return parseYaml(await fs.readFile(path.join(srcDir, "catalog.yaml"), "utf8")) as Catalog
}

function resolveModel(catalog: Catalog, host: Host, profile: string): ModelRef {
  const ref = catalog.hosts[host]?.profiles[profile]
  if (!ref?.id) throw new Error(`catalog: hosts.${host}.profiles.${profile} missing`)
  return ref
}

async function inlineIncludes(body: string, depth: number): Promise<string> {
  // Fragments may include fragments; the depth cap stops an include cycle.
  if (depth > 4) throw new Error("transpile: {{include:}} nested deeper than 4 — cycle?")
  let out = body
  for (const m of [...body.matchAll(/\{\{include:([^}]+)\}\}/g)]) {
    const frag = await fs.readFile(path.join(promptsDir, m[1]!.trim()), "utf8")
    const inlined = await inlineIncludes(frag.trim(), depth + 1)
    out = out.replace(m[0], () => inlined)
  }
  return out
}

/** A prompt body with its includes resolved. */
export async function renderPrompt(rel: string): Promise<string> {
  const out = await inlineIncludes((await fs.readFile(path.join(promptsDir, rel), "utf8")).trim(), 0)
  const left = out.match(/\{\{[a-z]+:[^}]*\}\}/)
  if (left) throw new Error(`transpile: unresolved placeholder ${left[0]} in ${rel}`)
  return `${out}\n`
}

function frontmatter(obj: Record<string, unknown>): string {
  return `---\n${stringifyYaml(obj, { lineWidth: 0 }).trimEnd()}\n---\n\n`
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

async function rmrf(dir: string) {
  await fs.rm(dir, { recursive: true, force: true })
}

export async function skillReferences(name: string): Promise<string[]> {
  return (await fs.readdir(path.join(promptsDir, "skills", name, "references")).catch(() => [] as string[])).sort()
}

async function emitSkills(catalog: Catalog) {
  const shared = path.join(distDir, "agents", "skills")
  const claude = path.join(distDir, "claude", "skills")
  for (const [name, skill] of Object.entries(catalog.skills)) {
    const body = await renderPrompt(`skills/${name}/SKILL.md`)
    const fm: Record<string, unknown> = { name, description: skill.description }
    if (skill.user_only) fm["disable-model-invocation"] = true
    const claudeFm = { ...fm }
    if (skill.profile) {
      const ref = resolveModel(catalog, "claude", skill.profile)
      claudeFm.model = ref.id
      if (ref.effort) claudeFm.effort = ref.effort
    }
    await writeFile(path.join(shared, name, "SKILL.md"), frontmatter(fm) + body)
    await writeFile(path.join(claude, name, "SKILL.md"), frontmatter(claudeFm) + body)
    for (const ref of await skillReferences(name)) {
      const text = await renderPrompt(`skills/${name}/references/${ref}`)
      await writeFile(path.join(shared, name, "references", ref), text)
      await writeFile(path.join(claude, name, "references", ref), text)
    }
  }
}

const denied = (rule: unknown) => rule === "deny"

function claudeTools(shadow: Shadow): string {
  const tools = ["Read", "Glob", "Grep"]
  if (!denied(shadow.permission?.edit)) tools.push("Edit", "Write")
  tools.push("Bash")
  return tools.join(", ")
}

function denyPatterns(rule: unknown): string[] {
  if (!rule || typeof rule !== "object") return []
  return Object.entries(rule as Record<string, string>)
    .filter(([, v]) => v === "deny")
    .map(([k]) => k)
}

/** Cursor has no permission config, so the hard denies survive as prose. */
function cursorRestrictions(shadow: Shadow): string {
  const lines: string[] = []
  const edit = shadow.permission?.edit
  if (denied(edit)) lines.push("- Do not edit or write any files.")
  else if (denyPatterns(edit).length) lines.push(`- Do not edit: ${denyPatterns(edit).join(", ")}.`)
  return lines.length ? `\n## Restrictions\n\n${lines.join("\n")}\n` : ""
}

async function emitShadows(catalog: Catalog) {
  for (const [name, shadow] of Object.entries(catalog.shadows)) {
    const body = await renderPrompt(`agents/${name}.md`)

    const claudeRef = resolveModel(catalog, "claude", shadow.profile)
    const claudeFm: Record<string, unknown> = {
      name,
      description: shadow.description,
      model: claudeRef.id,
    }
    if (claudeRef.effort) claudeFm.effort = claudeRef.effort
    claudeFm.tools = claudeTools(shadow)
    claudeFm.skills = shadow.skills
    // Keeps a continued shadow's prompt cache alive past the 5m subagent default.
    if (shadow.claude?.cache_ttl) claudeFm.experimental = { cacheTtl: shadow.claude.cache_ttl }
    await writeFile(path.join(distDir, "claude", "agents", `${name}.md`), frontmatter(claudeFm) + body)

    const cursorFm = {
      name,
      description: shadow.description,
      model: formatCursorModel(resolveModel(catalog, "cursor", shadow.profile)),
    }
    await writeFile(
      path.join(distDir, "cursor", "agents", `${name}.md`),
      `${frontmatter(cursorFm)}${body.trimEnd()}\n${cursorRestrictions(shadow)}`,
    )

    const codex = formatCodexModel(resolveModel(catalog, "codex", shadow.profile))
    const toml = [
      `name = ${JSON.stringify(name)}`,
      `description = ${JSON.stringify(shadow.description)}`,
      `developer_instructions = ${JSON.stringify(body.trim())}`,
      `model = ${JSON.stringify(codex.model)}`,
      ...(codex.reasoning ? [`model_reasoning_effort = ${JSON.stringify(codex.reasoning)}`] : []),
      `sandbox_mode = ${JSON.stringify(denied(shadow.permission?.edit) ? "read-only" : "workspace-write")}`,
    ]
    await writeFile(path.join(distDir, "codex", "agents", `${name}.toml`), `${toml.join("\n")}\n`)
  }
}

async function main() {
  const catalog = await loadCatalog()
  for (const dir of ["agents", "claude", "cursor", "codex"]) await rmrf(path.join(distDir, dir))
  await emitSkills(catalog)
  await emitShadows(catalog)
  console.log("transpile: wrote dist/agents/skills, dist/claude/{skills,agents}, dist/cursor/agents, dist/codex/agents")
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
