#!/usr/bin/env node
/**
 * Build the payload, record its tag and sha256 in release.json, commit that with the rebuilt bin/install.js, tag the
 * commit, push, and publish a GitHub Release carrying solodev-dist.tar.gz. The installer at a ref downloads exactly the
 * payload that release.json names, so the asset is attached as the release is created.
 *
 *   pnpm run release              # patch bump from the latest vX.Y.Z
 *   pnpm run release --minor
 *   pnpm run release --major
 *   pnpm run release v1.3.0
 */
import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { run } from "./sh.ts"

const PAYLOAD_ASSET = "solodev-dist.tar.gz"

type Bump = "major" | "minor" | "patch"

function die(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]): { bump: Bump; explicit?: string } {
  const flags = argv.filter((a) => a.startsWith("--"))
  const positionals = argv.filter((a) => !a.startsWith("--"))
  if (positionals.length > 1) die("expected at most one version argument")
  if (positionals[0]) {
    if (flags.length) die("pass either a version or a bump flag, not both")
    if (!/^v\d+\.\d+\.\d+$/.test(positionals[0])) {
      die(`invalid version ${positionals[0]} — expected vX.Y.Z`)
    }
    return { bump: "patch", explicit: positionals[0] }
  }
  const bumpFlags = flags.filter((f) => f === "--major" || f === "--minor" || f === "--patch")
  if (bumpFlags.length > 1) die("pass only one of --major, --minor, --patch")
  const unknown = flags.filter((f) => f !== "--major" && f !== "--minor" && f !== "--patch")
  if (unknown.length) die(`unknown flag ${unknown[0]}`)
  const bump = (bumpFlags[0]?.slice(2) as Bump | undefined) ?? "patch"
  return { bump }
}

function bumpVersion(tag: string, bump: Bump): string {
  const m = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/)
  if (!m) die(`latest tag ${tag} is not vX.Y.Z`)
  let major = Number(m[1])
  let minor = Number(m[2])
  let patch = Number(m[3])
  if (bump === "major") {
    major += 1
    minor = 0
    patch = 0
  } else if (bump === "minor") {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `v${major}.${minor}.${patch}`
}

async function latestTag(): Promise<string | undefined> {
  await run("git", ["fetch", "--tags", "origin"])
  const raw = await run("git", ["tag", "-l", "v*.*.*", "--sort=-v:refname"])
  if (!raw) return undefined
  return raw.split("\n").find((t) => /^v\d+\.\d+\.\d+$/.test(t))
}

async function main() {
  const { bump, explicit } = parseArgs(process.argv.slice(2))

  const dirty = await run("git", ["status", "--porcelain"])
  if (dirty) die("working tree is dirty — commit or stash first")

  const hasGh = await run("gh", ["--version"]).then(
    () => true,
    () => false,
  )
  if (!hasGh) die("gh is required to publish the GitHub Release")

  const previous = await latestTag()
  const tag = explicit ?? (previous ? bumpVersion(previous, bump) : "v0.1.0")

  const existsLocal = await run("git", ["tag", "-l", tag])
  if (existsLocal) die(`tag ${tag} already exists locally`)

  const remote = await run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`])
  if (remote) die(`tag ${tag} already exists on origin`)

  console.error("release: building the payload")
  await run("pnpm", ["run", "build"])
  await run("pnpm", ["run", "check"])
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "solodev-release-"))
  const archive = path.join(outDir, PAYLOAD_ASSET)
  // macOS tar would otherwise add AppleDouble ._ files.
  process.env.COPYFILE_DISABLE = "1"
  await run("tar", ["-czf", archive, "manifest.txt", "dist"])
  const sha256 = createHash("sha256")
    .update(await fs.readFile(archive))
    .digest("hex")
  await fs.writeFile("release.json", `${JSON.stringify({ version: tag, sha256 }, null, 2)}\n`)
  await run("node", ["tools/build-install.ts"])
  await run("git", ["add", "release.json", "bin/install.js"])
  await run("git", ["commit", "-m", `chore: release ${tag}`])

  const sha = await run("git", ["rev-parse", "HEAD"])
  console.error(`release: tagging ${sha.slice(0, 7)} as ${tag}${previous ? ` (was ${previous})` : ""}`)
  await run("git", ["tag", "-a", tag, "-m", `release ${tag}`])
  await run("git", ["push", "origin", "HEAD"])
  await run("git", ["push", "origin", tag])
  await run("gh", ["release", "create", tag, archive, "--title", tag, "--generate-notes", "--verify-tag"])
  await fs.rm(outDir, { recursive: true, force: true })
  console.error(`release: published ${tag} — pin with npx/bunx github:luisintosh/solodev#${tag}`)
}

await main()
