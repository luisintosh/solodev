#!/usr/bin/env node
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import catalog from "../catalog.yaml"
import { approve, type Dispatch } from "./approve.ts"
import { CHECK_SETS, type CheckSet, formatResults, runChecks } from "./checks.ts"
import { run } from "./exec.ts"
import { exists, featureDir, SLUG } from "./feature.ts"
import { HELP, helpText } from "./help.ts"
import { isTool, modelsFromCatalog, TOOLS } from "./models.ts"
import { detectHome, probe } from "./probe.ts"
import { branchFeature, featureStatus, formatStatus, ghPr, listFeatures, type Stage } from "./status.ts"

class UsageError extends Error {}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith("--")) throw new UsageError(`${name} needs a value`)
  return value
}

function positional(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("--")) {
      if (!["--json", "--help"].includes(args[i]!)) i++
      continue
    }
    out.push(args[i]!)
  }
  return out
}

async function repoRoot(): Promise<string> {
  if (process.env.SOLODEV_ROOT) return path.resolve(process.env.SOLODEV_ROOT)
  const r = await run("git", ["rev-parse", "--show-toplevel"])
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim()
  return process.cwd()
}

async function requireFeature(root: string, slug: string | undefined): Promise<string> {
  if (!slug) throw new UsageError("missing <slug>")
  if (!SLUG.test(slug)) throw new UsageError(`"${slug}" is not a feature slug (lowercase letters, digits, dashes)`)
  if (!(await exists(featureDir(root, slug)))) throw new UsageError(`docs/feats/${slug}/ does not exist`)
  return slug
}

const SET_FOR_STAGE: Partial<Record<Stage, CheckSet>> = { review: "pr", pr: "pr", "qa-docs": "done", done: "done" }

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(helpText(command === "help" ? args[0] : undefined))
    return 0
  }
  if (!HELP[command]) throw new UsageError(`unknown command "${command}"`)
  if (args.includes("--help")) {
    console.log(helpText(command))
    return 0
  }
  const root = await repoRoot()
  const models = modelsFromCatalog(catalog)
  const json = args.includes("--json")

  switch (command) {
    case "probe": {
      const result = await probe(
        {
          env: process.env,
          platform: process.platform,
          root,
          home: os.homedir(),
          exec: async (cmd, a) => {
            const r = await run(cmd, a, { cwd: root, timeoutMs: 15_000 })
            return { code: r.code, stdout: r.stdout }
          },
          which: async (bin) => (await run("sh", ["-c", `command -v ${bin}`])).code === 0,
          exists,
          read: (file) => fs.readFile(file, "utf8").catch(() => undefined),
        },
        models,
      )
      console.log(JSON.stringify(result, null, 2))
      return 0
    }
    case "status": {
      const slug = positional(args)[0] ?? (await branchFeature(root))
      if (slug) {
        const status = await featureStatus(root, await requireFeature(root, slug), { pr: ghPr })
        console.log(json ? JSON.stringify(status, null, 2) : formatStatus(status))
        return 0
      }
      const slugs = await listFeatures(root)
      if (!slugs.length) {
        console.log("no features under docs/feats/ — start one with /arise")
        return 0
      }
      // The PR belongs to the current branch, so the list leaves it out; name a slug for the full status.
      const all = await Promise.all(slugs.map((s) => featureStatus(root, s, { pr: async () => null })))
      if (json) console.log(JSON.stringify(all, null, 2))
      else for (const s of all) console.log(`${s.slug}: ${s.stage === "pr" ? "pr or later" : s.stage}`)
      return 0
    }
    case "approve": {
      const slug = await requireFeature(root, positional(args)[0])
      const writer = flag(args, "--writer")
      if (!writer || !isTool(writer)) throw new UsageError(`--writer must be one of ${TOOLS.join("|")}`)
      const viaFlag = flag(args, "--via")
      if (viaFlag && viaFlag !== "native" && viaFlag !== "orca") throw new UsageError("--via must be native or orca")
      const via: Dispatch =
        (viaFlag as Dispatch | undefined) ?? (writer === detectHome(process.env) ? "native" : "orca")
      const approval = await approve({ root, slug, writer, via, models })
      console.log(`approved ${slug} at ${approval.sha.slice(0, 7)}`)
      console.log(
        approval.message
          .split("\n")
          .filter((l) => l.startsWith("Solodev-"))
          .join("\n"),
      )
      return 0
    }
    case "check": {
      const slug = await requireFeature(root, positional(args)[0])
      const forFlag = flag(args, "--for")
      if (forFlag && !(forFlag in CHECK_SETS)) throw new UsageError("--for must be implement, pr or done")
      let set = forFlag as CheckSet | undefined
      if (!set) {
        const stage = (await featureStatus(root, slug, { pr: ghPr })).stage
        set = SET_FOR_STAGE[stage] ?? "implement"
      }
      const timeoutMs = Number(process.env.SOLODEV_TIMEOUT_MS) || 10 * 60_000
      const results = await runChecks({ root, slug, set, timeoutMs })
      if (json) console.log(JSON.stringify({ slug, set, results }, null, 2))
      else console.log(`solodev check ${slug} --for ${set}\n${formatResults(results)}`)
      return results.some((r) => r.status === "fail") ? 1 : 0
    }
    case "install":
      console.log("Install or update from the package: npx -y github:luisintosh/solodev")
      return 0
  }
  return 0
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (err) {
  console.error(`solodev: ${(err as Error).message}`)
  if (err instanceof UsageError) console.error("Run `solodev help` for usage.")
  process.exitCode = err instanceof UsageError ? 2 : 1
}
