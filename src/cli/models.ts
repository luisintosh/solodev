export const TOOLS = ["claude", "codex", "cursor"] as const
export type Tool = (typeof TOOLS)[number]

export type ModelRef = { id: string; effort?: string }
export type ToolModels = { think: ModelRef; implement: ModelRef }
export type Models = Record<Tool, ToolModels>

type CatalogSlice = { hosts?: Record<string, { profiles?: Record<string, ModelRef> }> }

/** The think and implement rows per coding tool, from the bundled catalog. */
export function modelsFromCatalog(catalog: CatalogSlice): Models {
  const out = {} as Models
  for (const tool of TOOLS) {
    const profiles = catalog.hosts?.[tool]?.profiles ?? {}
    const think = profiles.think
    const implement = profiles.implement
    if (!think?.id || !implement?.id) throw new Error(`catalog: hosts.${tool} needs think and implement profiles`)
    out[tool] = { think, implement }
  }
  return out
}

export function isTool(value: string): value is Tool {
  return (TOOLS as readonly string[]).includes(value)
}

/** `<tool>/<model>/<effort>`, the form the Solodev-Writer trailer and the gate card use. */
export function writerId(tool: Tool, ref: ModelRef): string {
  return [tool, ref.id, ref.effort].filter(Boolean).join("/")
}
