import * as fs from "node:fs/promises"
import * as path from "node:path"
import { type Phase, type Proof, parsePlan, proofLine, readIfExists } from "./feature.ts"
import { treeHash } from "./git.ts"

export type ProofOptions = {
  root: string
  dir: string
  /** Several only for a green: one run of their tests, together. */
  journeys: string[]
  phase: Phase
  exit: number
  output?: string
}

const TAIL_LINES = 6
const TAIL_WIDTH = 200
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal color codes from test output
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters from test output
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

/**
 * The output's last lines, each behind `  > ` so nothing in them reads as a progress.md log line. Splits wherever a
 * multiline regex sees a line start, a lone carriage return included.
 */
export function tail(output: string): string[] {
  return output
    .replace(ANSI, "")
    .split(/\r\n|[\r\n\u2028\u2029]/)
    .map((l) => l.replace(CONTROL, ""))
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-TAIL_LINES)
    .map((l) => `  > ${l.slice(0, TAIL_WIDTH)}`)
}

/**
 * Records one run of a journey's command in progress.md, or of several journeys' tests in one run for a green. The
 * coder ran it and reports the exit code; the tree hash is taken here, so C6 can tell a green that predates the last
 * edit. Runs nothing and commits nothing.
 */
export async function proof(opts: ProofOptions): Promise<Proof[]> {
  const spec = await readIfExists(path.join(opts.dir, "spec.md"))
  if (spec === undefined) throw new Error(`spec.md not found in ${opts.dir}`)
  const ids = parsePlan(spec).journeys.map((j) => j.id)
  if (!opts.journeys.length || opts.journeys.some((j) => !j)) throw new Error("name at least one journey")
  if (new Set(opts.journeys).size !== opts.journeys.length) throw new Error("a journey is named twice")
  const unknown = opts.journeys.filter((j) => !ids.includes(j))
  if (unknown.length) throw new Error(`the plan has no journey ${unknown.join(", ")} (${ids.join(", ")})`)
  if (opts.phase === "red" && opts.journeys.length > 1) {
    throw new Error(
      "a red is per journey: a run of several can fail on one and pass another, so record each from its own",
    )
  }
  if (opts.phase === "red" && opts.exit === 0) {
    throw new Error("red needs a non-zero exit: the test passed without the code, so it proves nothing yet")
  }
  if (opts.phase === "green" && opts.exit !== 0) {
    throw new Error(`green needs exit 0, got ${opts.exit}: the journey still fails`)
  }
  const tree = await treeHash(opts.root)
  const records: Proof[] = opts.journeys.map((journey) => ({ journey, phase: opts.phase, exit: opts.exit, tree }))
  const file = path.join(opts.dir, "progress.md")
  const progress = (await readIfExists(file)) ?? ""
  const sep = progress === "" || progress.endsWith("\n") ? "" : "\n"
  // One run, one output: its tail follows the last of the lines it proves.
  await fs.appendFile(file, `${sep}${[...records.map(proofLine), ...tail(opts.output ?? "")].join("\n")}\n`)
  return records
}
