#!/usr/bin/env node
/**
 * Publish develop's build to master. master holds only the product (dist/product: the skills, README.md, assets/), one
 * commit per release, each with a `Source: <develop sha>` trailer and tagged vX.Y.Z; `npx skills add
 * luisintosh/solodev` installs from it. Run on develop with a clean tree that is up to date with origin.
 *
 *   pnpm run release              # patch bump from the latest vX.Y.Z
 *   pnpm run release --minor
 *   pnpm run release --major
 *   pnpm run release v1.3.0
 */
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { run } from "./sh.ts"

const SOURCE_BRANCH = "develop"
const RELEASE_BRANCH = "master"

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

async function succeeds(cmd: string, args: string[]): Promise<boolean> {
  return run(cmd, args).then(
    () => true,
    () => false,
  )
}

/** Release notes: develop's commit subjects since the last release, grouped by Conventional Commit type. */
async function releaseNotes(previous: string | undefined): Promise<string> {
  let since = previous
  if (previous) {
    // Releases since the split record their develop commit; older tags sit in develop's own history.
    const source = await run("git", ["log", "-1", "--format=%(trailers:key=Source,valueonly)", previous])
    if (source) since = source.trim()
  }
  const subjects = (await run("git", ["log", "--format=%s", "--no-merges", since ? `${since}..HEAD` : "HEAD"]))
    .split("\n")
    .filter(Boolean)
  const groups: [string, RegExp][] = [
    ["Features", /^feat(\(.+\))?!?:/],
    ["Fixes", /^fix(\(.+\))?!?:/],
    ["Other", /./],
  ]
  const used = new Set<string>()
  const out: string[] = []
  for (const [title, re] of groups) {
    const items = subjects.filter((s) => !used.has(s) && re.test(s))
    for (const s of items) used.add(s)
    if (items.length) out.push(`## ${title}`, "", ...items.map((s) => `- ${s}`), "")
  }
  return out.join("\n") || "No changes since the last release.\n"
}

async function main() {
  const { bump, explicit } = parseArgs(process.argv.slice(2))

  const dirty = await run("git", ["status", "--porcelain"])
  if (dirty) die("working tree is dirty — commit or stash first")

  const branch = await run("git", ["branch", "--show-current"])
  if (branch !== SOURCE_BRANCH) die(`on ${branch || "a detached HEAD"} — releases are cut from ${SOURCE_BRANCH}`)
  await run("git", ["fetch", "origin", SOURCE_BRANCH])
  const [, behind] = (
    await run("git", ["rev-list", "--left-right", "--count", `HEAD...origin/${SOURCE_BRANCH}`])
  ).split(/\s+/)
  if (behind !== "0") die(`${SOURCE_BRANCH} is ${behind} commit(s) behind origin/${SOURCE_BRANCH} — pull first`)

  if (!(await succeeds("gh", ["--version"]))) die("gh is required to publish the GitHub Release")

  const previous = await latestTag()
  const tag = explicit ?? (previous ? bumpVersion(previous, bump) : "v0.1.0")
  if (await run("git", ["tag", "-l", tag])) die(`tag ${tag} already exists locally`)
  if (await run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]))
    die(`tag ${tag} already exists on origin`)

  console.error("release: building and checking")
  await run("pnpm", ["run", "build"])
  await run("pnpm", ["run", "check"])
  await run("pnpm", ["test"])

  // The first release after the split replaces the old master (the whole source tree, with package.json) with an
  // orphan product history; every later one adds a commit on top of origin/master.
  const remoteMaster = await run("git", ["ls-remote", "--heads", "origin", RELEASE_BRANCH])
  if (remoteMaster) await run("git", ["fetch", "origin", RELEASE_BRANCH])
  const oldLayout =
    Boolean(remoteMaster) && (await succeeds("git", ["cat-file", "-e", `origin/${RELEASE_BRANCH}:package.json`]))
  const orphan = !remoteMaster || oldLayout
  if (oldLayout)
    console.error(`release: origin/${RELEASE_BRANCH} still holds the source tree; replacing it (force push)`)

  const source = await run("git", ["rev-parse", "HEAD"])
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "solodev-release-"))
  const tree = path.join(tmp, "master")
  const tempBranch = `solodev-release-${process.pid}`
  try {
    if (orphan) {
      await run("git", ["worktree", "add", "--detach", tree, "HEAD"])
      await run("git", ["checkout", "-q", "--orphan", tempBranch], tree)
    } else {
      await run("git", ["worktree", "add", "--detach", tree, `origin/${RELEASE_BRANCH}`])
    }
    await run("git", ["rm", "-rfq", "--ignore-unmatch", "."], tree)
    await fs.cp(path.join("dist", "product"), tree, { recursive: true })
    await run("git", ["add", "-A"], tree)
    await run("git", ["commit", "-q", "--allow-empty", "-m", `release ${tag}`, "-m", `Source: ${source}`], tree)
    const sha = await run("git", ["rev-parse", "HEAD"], tree)
    console.error(`release: ${RELEASE_BRANCH} ${sha.slice(0, 7)} = develop ${source.slice(0, 7)}, tagged ${tag}`)
    await run("git", ["tag", "-a", tag, sha, "-m", `release ${tag}`])
    await run("git", ["push", ...(oldLayout ? ["--force"] : []), "origin", `${sha}:refs/heads/${RELEASE_BRANCH}`])
    await run("git", ["push", "origin", tag])
  } finally {
    await run("git", ["worktree", "remove", "--force", tree]).catch(() => undefined)
    if (orphan) await run("git", ["branch", "-D", tempBranch]).catch(() => undefined)
  }

  const notes = path.join(tmp, "notes.md")
  await fs.writeFile(notes, await releaseNotes(previous))
  await run("gh", ["release", "create", tag, "--title", tag, "--notes-file", notes, "--verify-tag"])
  await fs.rm(tmp, { recursive: true, force: true })
  console.error(
    `release: published ${tag} — npx skills add luisintosh/solodev, or pin https://github.com/luisintosh/solodev/tree/${tag}`,
  )
}

await main()
