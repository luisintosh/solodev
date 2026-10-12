#!/usr/bin/env node
/**
 * Emit dist/cursor, dist/claude, dist/codex, and dist/agents/skills.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import {
  formatClaudeModel,
  formatCodexModel,
  formatCursorModel,
  type Host,
  type ModelRef,
} from "./models.ts"
import { type OrcaRoutes, orcaAgentFile, orcaLaunchCommand, orcaRoutesByAgent } from "../src/state/orca.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = path.join(root, "src")
const distDir = path.join(root, "dist")

type AgentCatalog = {
  /** User-facing name of a skill; the catalog key when absent. */
  command?: string
  profile: string
  description: string
  /** Hard denies only: `edit` and `bash` maps of pattern → "deny", or a bare "deny" for the whole tool. */
  permission?: { edit?: unknown; bash?: unknown }
  cursor?: {
    readonly?: boolean
    skill?: boolean
  }
  claude?: {
    /** Only for agents the conductor continues: a longer TTL costs 2x per write and pays off only on reuse. */
    cache_ttl?: "5m" | "1h"
  }
}

type Catalog = {
  hosts: Record<Host, { profiles: Record<string, ModelRef> }>
  orchestrators?: { orca?: { profiles?: OrcaRoutes } }
  agents: Record<string, AgentCatalog>
  commands: Record<string, { description: string }>
}

function resolveModel(catalog: Catalog, host: Host, agent: AgentCatalog): ModelRef {
  const ref = catalog.hosts[host]?.profiles[agent.profile]
  if (!ref?.id) {
    throw new Error(`catalog: hosts.${host}.profiles.${agent.profile} missing`)
  }
  return ref
}

function isReadonly(agent: AgentCatalog): boolean {
  if (agent.cursor?.readonly) return true
  return agent.permission?.edit === "deny"
}

function bashDenied(agent: AgentCatalog): boolean {
  return agent.permission?.bash === "deny"
}

function claudeTools(agent: AgentCatalog): string {
  const tools = isReadonly(agent) ? ["Read", "Glob", "Grep"] : ["Read", "Glob", "Grep", "Edit", "Write"]
  if (!bashDenied(agent)) tools.push("Bash")
  return tools.join(", ")
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

async function loadCatalog(): Promise<Catalog> {
  const raw = await fs.readFile(path.join(srcDir, "catalog.yaml"), "utf8")
  return parseYaml(raw) as Catalog
}

function orcaRoutesTable(catalog: Catalog): string {
  const rows = Object.entries(orcaRoutesByAgent(catalog)).map(([name, route]) => {
    const profile = catalog.agents[name]!.profile
    return `| \`${name}\` | ${profile} | \`${orcaLaunchCommand(route)}\` | \`${orcaAgentFile(route.agent, name)}\` |`
  })
  return ["| Specialist | Profile | Launch command | Agent file |", "| --- | --- | --- | --- |", ...rows].join("\n")
}

/**
 * Where a prompt body is emitted. `skill` renders the conductor's on-demand references as pointers; `plain`
 * (subagents, checklists, reference files themselves) must not use those placeholders at all.
 */
type Target = "skill" | "plain"

const HOSTS = ["claude", "cursor", "codex"] as const

// Conductor fragments loaded on demand. Skills link a sibling references/<file>.
const REFERENCES = ["reply-mapping.md", "handoff.md", "orca.md", "escalation.md", "dispute.md", "design-delta.md"]

// Reference fragments pulled in with a plain {{include:}}: the include becomes this pointer. The others are named at
// their trigger with {{ref:<file>}}.
const INCLUDE_POINTERS: Record<string, string[]> = {
  "reply-mapping.md": [
    "## Applying subagent replies",
    "",
    "Reply keys are not state keys. Read {{loc:reply-mapping.md}} before the first patch — translate every reply; never",
    "pass one through verbatim.",
  ],
  "handoff.md": ["{{ref:handoff.md}}"],
  "orca.md": [
    "## Orca dispatch",
    "",
    "Applies only when state has `tools.orchestrator: orca`; otherwise skip it. Then read {{loc:orca.md}} before the",
    "first dispatch, resume, or close.",
  ],
}

function refLocation(file: string, target: Target): string {
  if (!REFERENCES.includes(file)) throw new Error(`transpile: ${file} is not a conductor reference`)
  if (target === "skill") return `[references/${file}](references/${file})`
  throw new Error(`transpile: {{ref:${file}}} used in a plain prompt`)
}

async function inlineIncludes(body: string, depth: number): Promise<string> {
  // Fragments may include fragments; the depth cap stops an include cycle.
  if (depth > 4) throw new Error("transpile: {{include:}} nested deeper than 4 — cycle?")
  const re = /\{\{include:([^}]+)\}\}/g
  let out = body
  for (const m of [...body.matchAll(re)]) {
    const rel = m[1]!.trim()
    const frag = await fs.readFile(path.join(srcDir, "prompts", rel), "utf8")
    const inlined = await inlineIncludes(frag.trim(), depth + 1)
    out = out.replace(m[0], () => inlined)
  }
  return out
}

async function hostDelegation(target: Target): Promise<string> {
  if (target === "plain") throw new Error("transpile: {{hosts:delegation}} used in a plain prompt")
  // Skills keep every host: Cursor can also load .claude/skills or .agents/skills, so a stripped copy could leave a host
  // with no delegation instructions.
  const parts = await Promise.all(
    HOSTS.map((h) => fs.readFile(path.join(srcDir, "prompts", "fragments", "hosts", `${h}.md`), "utf8")),
  )
  return parts.map((p) => p.trim()).join("\n")
}

async function resolveIncludes(
  body: string,
  catalog: Catalog,
  target: Target = "plain",
  refs: Set<string> = new Set(),
): Promise<string> {
  let out = await inlineIncludes(body, 0)
  // Generated after includes so fragments may carry them.
  out = out.replaceAll("{{orca:routes}}", orcaRoutesTable(catalog))
  if (out.includes("{{hosts:delegation}}")) out = out.replaceAll("{{hosts:delegation}}", await hostDelegation(target))
  out = out.replace(/\{\{ref:([^}]+)\}\}/g, (_, file: string) => {
    refs.add(file)
    return `Read ${refLocation(file, target)} and follow it.`
  })
  out = out.replace(/\{\{loc:([^}]+)\}\}/g, (_, file: string) => {
    refs.add(file)
    return refLocation(file, target)
  })
  const left = out.match(/\{\{[a-z]+:[^}]*\}\}/)
  if (left) throw new Error(`transpile: unresolved placeholder ${left[0]}`)
  return out
}

/** Renders a prompt for `target`, collecting the references its pointers name into `refs`. */
async function renderPrompt(rel: string, catalog: Catalog, target: Target, refs: Set<string> = new Set()) {
  let raw = await fs.readFile(path.join(srcDir, "prompts", rel), "utf8")
  if (target !== "plain") {
    for (const [file, pointer] of Object.entries(INCLUDE_POINTERS)) {
      raw = raw.replace(`{{include:fragments/${file}}}`, `${pointer.join("\n")}\n`)
    }
  }
  return resolveIncludes(`${raw.trim()}\n`, catalog, target, refs)
}

async function readPrompt(rel: string, catalog: Catalog): Promise<string> {
  return renderPrompt(rel, catalog, "plain")
}

async function writeReferences(catalog: Catalog, refs: Set<string>, outDir: string) {
  for (const file of [...refs].sort()) {
    await writeFile(path.join(outDir, file), await readPrompt(`fragments/${file}`, catalog))
  }
}

function yamlFrontmatter(obj: Record<string, unknown>): string {
  const yaml = stringifyYaml(obj, { lineWidth: 0 }).trimEnd()
  return `---\n${yaml}\n---\n\n`
}

function cursorRestrictions(agent: AgentCatalog): string {
  const perm = agent.permission
  if (!perm || typeof perm !== "object") return ""
  const edit = (perm as { edit?: unknown }).edit
  const lines: string[] = []
  if (edit === "deny") {
    lines.push("- Do not edit or write any files (read-only).")
  } else if (edit && typeof edit === "object") {
    const map = edit as Record<string, string>
    const denies = Object.entries(map)
      .filter(([, v]) => v === "deny")
      .map(([k]) => k)
    const allows = Object.entries(map)
      .filter(([k, v]) => v === "allow" && k !== "*")
      .map(([k]) => k)
    if (map["*"] === "deny" && allows.length) {
      lines.push(`- Edit only: ${allows.join(", ")}.`)
    }
    // Cursor has no permission config, so deny carve-outs have to survive into
    // the prose even when the allow list is already narrow.
    const carveOuts = denies.filter((k) => k !== "*")
    if (carveOuts.length) {
      lines.push(`- Never edit: ${carveOuts.join(", ")}.`)
    }
  }
  if (bashDenied(agent)) lines.push("- Do not run shell commands.")
  if (!lines.length) return ""
  return `\n## Tool restrictions (Cursor)\n${lines.join("\n")}\n`
}

async function rmrf(dir: string) {
  await fs.rm(dir, { recursive: true, force: true })
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

// Per-area review checklists, installed to <agentsRoot>/solodev/checklists/. The conductor passes the absolute path of
// one to each shadow-code-reviewer run; the header line lets the reviewer reject a wrong file.
const REVIEW_CHECKLISTS: Record<string, string[]> = {
  contract: ["fragments/review-contract.md"],
  health: ["fragments/review-health.md"],
  design: ["fragments/review-design.md", "fragments/design-practices.md"],
}

async function emitReviewChecklists(catalog: Catalog) {
  const outRoot = path.join(distDir, "agents", "solodev", "checklists")
  await rmrf(outRoot)
  for (const [area, fragments] of Object.entries(REVIEW_CHECKLISTS)) {
    const parts: string[] = []
    for (const rel of fragments) parts.push((await readPrompt(rel, catalog)).trim())
    await writeFile(
      path.join(outRoot, `review-${area}.md`),
      `# solodev review checklist: ${area}\n\n${parts.join("\n\n")}\n`,
    )
  }
}

async function emitSharedSkills(catalog: Catalog) {
  const outRoot = path.join(distDir, "agents", "skills")
  await rmrf(outRoot)

  for (const [name, agent] of Object.entries(catalog.agents)) {
    if (!agent.cursor?.skill) continue
    const skill = agent.command ?? name
    const refs = new Set<string>()
    const body = await renderPrompt(`agents/${name}.md`, catalog, "skill", refs)
    await writeReferences(catalog, refs, path.join(outRoot, skill, "references"))
    const restrictions = cursorRestrictions(agent)
    const skillFm = {
      name: skill,
      description: agent.description,
    }
    await writeFile(
      path.join(outRoot, skill, "SKILL.md"),
      `${yamlFrontmatter(skillFm)}${body.trimEnd() + restrictions}\n`,
    )
  }

  for (const [name, meta] of Object.entries(catalog.commands)) {
    const body = await readPrompt(`commands/${name}.md`, catalog)
    const fm = {
      name,
      description: meta.description,
      "disable-model-invocation": true,
    }
    await writeFile(path.join(outRoot, name, "SKILL.md"), yamlFrontmatter(fm) + body)
  }
}

async function emitCursor(catalog: Catalog) {
  const outRoot = path.join(distDir, "cursor")
  await rmrf(outRoot)

  for (const [name, agent] of Object.entries(catalog.agents)) {
    if (agent.cursor?.skill) continue
    const body = await readPrompt(`agents/${name}.md`, catalog)
    const restrictions = cursorRestrictions(agent)
    const fullBody = `${body.trimEnd() + restrictions}\n`

    const fm: Record<string, unknown> = {
      name,
      description: agent.description,
      model: formatCursorModel(resolveModel(catalog, "cursor", agent)),
    }
    if (agent.cursor?.readonly) fm.readonly = true
    await writeFile(path.join(outRoot, "agents", `${name}.md`), yamlFrontmatter(fm) + fullBody)
  }
}

async function emitClaude(catalog: Catalog) {
  const outRoot = path.join(distDir, "claude")
  await rmrf(outRoot)

  for (const [name, agent] of Object.entries(catalog.agents)) {
    if (agent.cursor?.skill) continue
    const body = await readPrompt(`agents/${name}.md`, catalog)
    const ref = resolveModel(catalog, "claude", agent)
    const fm: Record<string, unknown> = {
      name,
      description: agent.description,
      model: formatClaudeModel(ref),
    }
    if (ref.effort) fm.effort = ref.effort
    // Keeps a continued agent's prompt cache alive past the 5m subagent default; Claude Code < 2.1.248 ignores the key.
    if (agent.claude?.cache_ttl) fm.experimental = { cacheTtl: agent.claude.cache_ttl }
    fm.tools = claudeTools(agent)
    await writeFile(path.join(outRoot, "agents", `${name}.md`), yamlFrontmatter(fm) + body)
  }
}

async function emitCodex(catalog: Catalog) {
  const outRoot = path.join(distDir, "codex")
  await rmrf(outRoot)

  for (const [name, agent] of Object.entries(catalog.agents)) {
    if (agent.cursor?.skill) continue
    const body = await readPrompt(`agents/${name}.md`, catalog)
    const resolved = formatCodexModel(resolveModel(catalog, "codex", agent))
    const sandbox = isReadonly(agent) ? "read-only" : "workspace-write"
    const lines = [
      `name = ${tomlString(name)}`,
      `description = ${tomlString(agent.description)}`,
      `developer_instructions = ${tomlString(body.trim())}`,
    ]
    if (resolved.model !== "inherit") {
      lines.push(`model = ${tomlString(resolved.model)}`)
      if (resolved.reasoning) lines.push(`model_reasoning_effort = ${tomlString(resolved.reasoning)}`)
    }
    lines.push(`sandbox_mode = ${tomlString(sandbox)}`)
    await writeFile(path.join(outRoot, "agents", `${name}.toml`), `${lines.join("\n")}\n`)
  }
}

async function main() {
  const catalog = await loadCatalog()
  await fs.mkdir(distDir, { recursive: true })
  await emitSharedSkills(catalog)
  await emitReviewChecklists(catalog)
  await emitCursor(catalog)
  await emitClaude(catalog)
  await emitCodex(catalog)
  console.log(
    "transpile: wrote dist/cursor, dist/claude, dist/codex, dist/agents/skills, and dist/agents/solodev/checklists",
  )
}

await main()
