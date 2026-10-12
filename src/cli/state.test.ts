import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { keyFromRemote, repoKey, stateDir, stateRoot } from "./state.ts"

describe("keyFromRemote", () => {
  test.each([
    "git@github.com:luisintosh/hola-app.git",
    "github.com:luisintosh/hola-app",
    "ssh://git@github.com:22/luisintosh/hola-app.git",
    "https://github.com/luisintosh/hola-app",
    "https://github.com/luisintosh/hola-app.git/",
    "https://user:token@github.com/luisintosh/hola-app.git",
    "git://github.com/luisintosh/hola-app.git",
  ])("%s → luisintosh/hola-app", (url) => {
    expect(keyFromRemote(url)).toBe("luisintosh/hola-app")
  })

  test("keeps GitLab subgroups", () => {
    expect(keyFromRemote("https://gitlab.com/group/sub/repo.git")).toBe("group/sub/repo")
  })

  test.each(["/srv/git/repo.git", "file:///srv/git/repo.git", "../repo", "https://host/a/../../etc", "https://host/"])(
    "%s has no key",
    (url) => {
      expect(keyFromRemote(url)).toBeUndefined()
    },
  )
})

describe("repoKey", () => {
  let base: string
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" })

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "solodev-key-")))
    fs.mkdirSync(path.join(base, "hola-app"))
    git(path.join(base, "hola-app"), "init", "-q", "-b", "main")
    git(
      path.join(base, "hola-app"),
      "-c",
      "user.email=t@e",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "i",
    )
  })

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true })
  })

  test("uses origin's owner/repo", async () => {
    git(path.join(base, "hola-app"), "remote", "add", "origin", "https://github.com/luisintosh/hola-app.git")
    expect(await repoKey(path.join(base, "hola-app"))).toBe("luisintosh/hola-app")
  })

  test("without origin, the main checkout's folder name, from every worktree", async () => {
    const repo = path.join(base, "hola-app")
    git(repo, "worktree", "add", "-q", path.join(base, "hola-app-wt"))
    expect(await repoKey(repo)).toBe("hola-app")
    expect(await repoKey(path.join(base, "hola-app-wt"))).toBe("hola-app")
  })

  test("lives under SOLODEV_STATE or ~/.agents/skills/solodev", async () => {
    expect(stateRoot({}, "/home/u")).toBe("/home/u/.agents/skills/solodev")
    expect(await stateDir(path.join(base, "hola-app"), { SOLODEV_STATE: "/tmp/s" }, "/home/u")).toBe("/tmp/s/hola-app")
  })
})
