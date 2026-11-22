export const TOOLS = ["claude", "codex", "cursor"] as const
export type Tool = (typeof TOOLS)[number]

/**
 * The coder per coding tool: a short `<model>/<effort>` value (`sonnet/high`, `sol/xhigh`) or `session`. solodev passes
 * it through as written; the commander resolves it to a real model when it starts the coder.
 */
export type Models = Record<Tool, { coder: string }>

type CatalogSlice = { hosts?: Record<string, { coder?: unknown }> }

/** Each coding tool's default coder, from the bundled catalog. */
export function modelsFromCatalog(catalog: CatalogSlice): Models {
  const out = {} as Models
  for (const tool of TOOLS) {
    const coder = catalog.hosts?.[tool]?.coder
    if (typeof coder !== "string" || !coder.trim()) throw new Error(`catalog: hosts.${tool} needs a coder`)
    out[tool] = { coder: coder.trim() }
  }
  return out
}

export function isTool(value: string): value is Tool {
  return (TOOLS as readonly string[]).includes(value)
}
