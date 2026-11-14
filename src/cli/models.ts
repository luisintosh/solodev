export const TOOLS = ["claude", "codex", "cursor"] as const
export type Tool = (typeof TOOLS)[number]

export type ModelRef = { id: string; effort?: string }
/** `shadows` holds what each shadow runs on: its profile's model, at its own effort when the catalog sets one. */
export type ToolModels = { think: ModelRef; implement: ModelRef; shadows: Record<string, ModelRef> }
export type Models = Record<Tool, ToolModels>

type CatalogSlice = {
  hosts?: Record<string, { profiles?: Record<string, ModelRef> }>
  shadows?: Record<string, { profile: string; effort?: Record<string, string> }>
}

/** The think and implement rows and each shadow's model per coding tool, from the bundled catalog. */
export function modelsFromCatalog(catalog: CatalogSlice): Models {
  const out = {} as Models
  for (const tool of TOOLS) {
    const profiles = catalog.hosts?.[tool]?.profiles ?? {}
    const think = profiles.think
    const implement = profiles.implement
    if (!think?.id || !implement?.id) throw new Error(`catalog: hosts.${tool} needs think and implement profiles`)
    const shadows: Record<string, ModelRef> = {}
    for (const [name, shadow] of Object.entries(catalog.shadows ?? {})) {
      const ref = profiles[shadow.profile]
      if (!ref?.id) throw new Error(`catalog: shadows.${name} names profile ${shadow.profile}, which ${tool} lacks`)
      const effort = shadow.effort?.[tool]
      shadows[name] = effort ? { ...ref, effort } : ref
    }
    out[tool] = { think, implement, shadows }
  }
  return out
}

export function isTool(value: string): value is Tool {
  return (TOOLS as readonly string[]).includes(value)
}

/** `<tool>/<model>/<effort>`, the form the gate card and progress.md use. */
export function writerId(tool: Tool, ref: ModelRef): string {
  return [tool, ref.id, ref.effort].filter(Boolean).join("/")
}
