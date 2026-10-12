export type Host = "claude" | "codex" | "cursor"

export const HOSTS: readonly Host[] = ["claude", "codex", "cursor"]

export type ModelRef = {
  id: string
  effort?: string
}

export const PROFILE_NAMES = ["think", "implement"] as const

export type ProfileName = (typeof PROFILE_NAMES)[number]

export function formatCursorModel(ref: ModelRef): string {
  if (ref.effort) return `${ref.id}[effort=${ref.effort}]`
  return `${ref.id}[]`
}

export function formatClaudeDisplay(ref: ModelRef): string {
  return ref.effort ? `${ref.id}[effort=${ref.effort}]` : ref.id
}

export function formatCodexModel(ref: ModelRef): { model: string; reasoning?: string } {
  return ref.effort ? { model: ref.id, reasoning: ref.effort } : { model: ref.id }
}

export function formatCodexDisplay(ref: ModelRef): string {
  const resolved = formatCodexModel(ref)
  return resolved.reasoning ? `${resolved.model}[${resolved.reasoning}]` : resolved.model
}

/** How each host's matrix cell reads in README.md. */
export const DISPLAY: Record<Host, (ref: ModelRef) => string> = {
  claude: formatClaudeDisplay,
  codex: formatCodexDisplay,
  cursor: formatCursorModel,
}

/** The pinned models, restated so a catalog edit has to be deliberate. */
export const GOLDEN_MODELS: Record<Host, Record<ProfileName, string>> = {
  claude: { think: "claude-opus-5-5[effort=medium]", implement: "claude-sonnet-5-5[effort=high]" },
  codex: { think: "gpt-6.1-sol[max]", implement: "gpt-6.1-sol[medium]" },
  cursor: { think: "grok-4.7[effort=xhigh]", implement: "grok-4.7[effort=medium]" },
}
