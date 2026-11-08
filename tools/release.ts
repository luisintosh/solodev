#!/usr/bin/env node
/**
 * Cut a release on master. `npx skills add luisintosh/solodev` installs the committed skills/ at the repo root, and only
 * a release writes it: this builds, checks and tests, replaces skills/ with dist/product/skills in one commit,
 * `release vX.Y.Z`, that touches nothing else, tags it and pushes both. Run on master with a clean tree that is up to
 * date with origin.
 *
 *   pnpm run release              # patch bump from the latest vX.Y.Z
 *   pnpm run release --minor
 *   pnpm run release --major
 *   pnpm run release v1.3.0
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { run } from "./sh.ts"

const BRANCH = "master"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

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

  const branch = await run("git", ["branch", "--show-current"])
  if (branch !== BRANCH) die(`on ${branch || "a detached HEAD"} — releases are cut from ${BRANCH}`)
  await run("git", ["fetch", "origin", BRANCH])
  const [, behind] = (await run("git", ["rev-list", "--left-right", "--count", `HEAD...origin/${BRANCH}`])).split(/\s+/)
  if (behind !== "0") die(`${BRANCH} is ${behind} commit(s) behind origin/${BRANCH} — pull first`)

  const previous = await latestTag()
  const tag = explicit ?? (previous ? bumpVersion(previous, bump) : "v0.1.0")
  if (await run("git", ["tag", "-l", tag])) die(`tag ${tag} already exists locally`)
  if (await run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]))
    die(`tag ${tag} already exists on origin`)

  console.error("release: building and checking")
  await run("pnpm", ["run", "build"])
  await run("pnpm", ["run", "check"])
  await run("pnpm", ["test"])

  const skills = path.join(root, "skills")
  await fs.rm(skills, { recursive: true, force: true })
  await fs.cp(path.join(root, "dist", "product", "skills"), skills, { recursive: true })
  await run("git", ["add", "-A", "--", "skills"])
  if (!(await run("git", ["diff", "--cached", "--name-only"])))
    die("skills/ already matches the build — nothing to release")
  await run("git", ["commit", "-q", "-m", `release ${tag}`])
  // The new commit must pass the skills/ rule: a release commit, touching only skills/, equal to the build.
  await run("pnpm", ["run", "check"])

  await run("git", ["tag", "-a", tag, "-m", `release ${tag}`])
  await run("git", ["push", "origin", BRANCH])
  await run("git", ["push", "origin", tag])
  console.error(
    `release: pushed ${tag} — npx skills add luisintosh/solodev, or pin npx skills add luisintosh/solodev@${tag}`,
  )
}

await main()
