import * as fs from "node:fs/promises"
import * as path from "node:path"
import { type Phase, type Proof, parsePlan, proofLine, readIfExists } from "./feature.ts"
import { treeHash } from "./git.ts"

export type ProofOptions = { root: string; dir: string; journey: string; phase: Phase; exit: number; output?: string }

const TAIL_LINES = 6
const TAIL_WIDTH = 200
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal color codes from test output
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

/** The output's last lines, each behind `  > ` so nothing in them reads as a progress.md log line. */
export function tail(output: string): string[] {
  return output
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-TAIL_LINES)
    .map((l) => `  > ${l.slice(0, TAIL_WIDTH)}`)
}

/**
 * Records one run of a journey's command in progress.md. The coder ran it and reports the exit code; the tree hash is
 * taken here, so C6 can tell a green that predates the last edit. Runs nothing and commits nothing.
 */
export async function proof(opts: ProofOptions): Promise<Proof> {
  const spec = await readIfExists(path.join(opts.dir, "spec.md"))
  if (spec === undefined) throw new Error(`spec.md not found in ${opts.dir}`)
  const ids = parsePlan(spec).journeys.map((j) => j.id)
  if (!ids.includes(opts.journey)) throw new Error(`the plan has no journey ${opts.journey} (${ids.join(", ")})`)
  if (opts.phase === "red" && opts.exit === 0) {
    throw new Error("red needs a non-zero exit: the test passed without the code, so it proves nothing yet")
  }
  if (opts.phase === "green" && opts.exit !== 0) {
    throw new Error(`green needs exit 0, got ${opts.exit}: the journey still fails`)
  }
  const record: Proof = { journey: opts.journey, phase: opts.phase, exit: opts.exit, tree: await treeHash(opts.root) }
  const file = path.join(opts.dir, "progress.md")
  const progress = (await readIfExists(file)) ?? ""
  const sep = progress === "" || progress.endsWith("\n") ? "" : "\n"
  await fs.writeFile(file, `${progress}${sep}${[proofLine(record), ...tail(opts.output ?? "")].join("\n")}\n`)
  return record
}
