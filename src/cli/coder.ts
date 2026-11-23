import { isMap, isScalar, parseDocument } from "yaml"
import { isTool, type Models, TOOLS, type Tool } from "./models.ts"

export type CoderArgs = { tool?: Tool; value?: string }

/**
 * `solodev coder [<tool>] [<value> | default]`: a first word that isn't a tool is the value, for the home tool. Two
 * words name the tool, then the value.
 */
export function parseCoderArgs(words: string[]): CoderArgs {
  if (words.length > 2) throw new Error("usage: solodev coder [<tool>] [<model>/<effort> | session | default]")
  const [first, second] = words
  if (first === undefined) return {}
  if (isTool(first)) return second === undefined ? { tool: first } : { tool: first, value: checkValue(second) }
  if (second !== undefined) throw new Error(`unknown tool "${first}" (claude, codex or cursor)`)
  return { value: checkValue(first) }
}

function checkValue(value: string): string {
  if (!value.trim() || /\s/.test(value))
    throw new Error(`"${value}" isn't a coder: give <model>/<effort>, e.g. opus/high`)
  return value
}

/**
 * The config file with `coder.<tool>` set to `value`, or removed for `default`, keeping its comments and other keys.
 * An empty `coder:` map is dropped.
 */
export function withCoder(raw: string | undefined, tool: Tool, value: string): string {
  const doc = parseDocument(raw ?? "")
  if (doc.errors.length) throw new Error(`the config file isn't valid YAML: ${doc.errors[0]!.message}`)
  if (value === "default") {
    if (!isMap(doc.contents) || !doc.has("coder")) return raw ?? ""
    const coder = doc.get("coder")
    if (isMap(coder)) coder.delete(tool)
    if (!isMap(coder) || coder.items.length === 0) doc.delete("coder")
  } else {
    const empty = doc.contents === null || (isScalar(doc.contents) && doc.contents.value === null)
    if (empty) doc.contents = doc.createNode({})
    else if (!isMap(doc.contents)) throw new Error("the config file isn't a YAML map of settings")
    if (isMap(doc.get("coder"))) doc.setIn(["coder", tool], value)
    else doc.set("coder", doc.createNode({ [tool]: value }))
  }
  const out = doc.toString()
  return out.trim() === "{}" || out.trim() === "" ? "" : out
}

/** One line per tool: what its coder starts on, and whether that's the user's or solodev's default. */
export function formatCoders(models: Models, configured: Partial<Record<Tool, string>>, only?: Tool): string {
  const lines: string[] = []
  for (const tool of TOOLS) {
    if (only && tool !== only) continue
    const mine = configured[tool]
    const dflt = models[tool].coder
    const note = mine === undefined ? "default" : `yours; default ${dflt}`
    lines.push(`  ${tool.padEnd(7)} ${(mine ?? dflt).padEnd(14)} (${note})`)
  }
  return lines.join("\n")
}
