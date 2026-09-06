import { createHash } from "node:crypto"
import { describe, expect, test } from "vitest"
import { type AgentFiles, agentsDir, type InitInput, intact, locate, planInit, stripHash, withHash } from "./init.ts"

const agents: AgentFiles = {
  claude: { "shadow-coder.md": "coder\n", "shadow-reviewer.md": "reviewer\n" },
  codex: { "shadow-coder.toml": 'name = "shadow-coder"\n', "shadow-reviewer.toml": 'name = "shadow-reviewer"\n' },
  cursor: { "shadow-coder.md": "coder\n", "shadow-reviewer.md": "reviewer\n" },
}

function input(files: Record<string, string>, over: Partial<InitInput> = {}): InitInput {
  return {
    host: "claude",
    scope: "project",
    root: "/repo",
    home: "/home/u",
    env: {},
    agents,
    force: false,
    read: async (p) => files[p],
    exists: async (p) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
    ...over,
  }
}

const kinds = async (i: InitInput) => (await planInit(i)).map((op) => `${op.kind} ${op.path}`)

describe("hash line", () => {
  test("round-trips and spots edits", () => {
    const md = withHash("a.md", "body\n")
    expect(md).toMatch(/^body\n<!-- solodev-hash: [0-9a-f]{16} -->\n$/)
    expect(stripHash(md)).toBe("body\n")
    expect(intact(md)).toBe(true)
    expect(intact(md.replace("body", "edited"))).toBe(false)
    expect(intact("no mark\n")).toBeUndefined()
    expect(withHash("a.toml", "x = 1\n")).toMatch(/\n# solodev-hash: [0-9a-f]{16}\n$/)
  })
})

describe("agentsDir", () => {
  test("per host and scope", () => {
    expect(agentsDir("claude", "project", "/repo", "/home/u", {})).toBe("/repo/.claude/agents")
    expect(agentsDir("cursor", "global", "/home/u", "/home/u", {})).toBe("/home/u/.cursor/agents")
    expect(agentsDir("codex", "global", "/home/u", "/home/u", { CODEX_HOME: "/c" })).toBe("/c/agents")
    expect(agentsDir("codex", "project", "/repo", "/home/u", { CODEX_HOME: "/c" })).toBe("/repo/.codex/agents")
  })
})

describe("locate", () => {
  const cli = (base: string) => `${base}/skills/solodev-mission/scripts/solodev-cli.mjs`
  test("project and global installs", () => {
    expect(locate(cli("/repo/.agents"), "/home/u", {})).toEqual({ scope: "project", base: "/repo" })
    expect(locate(cli("/home/u/.claude"), "/home/u", {})).toEqual({ scope: "global", base: "/home/u" })
    expect(locate(cli("/opt/codex"), "/home/u", { CODEX_HOME: "/opt/codex" })).toEqual({
      scope: "global",
      base: "/home/u",
    })
  })
  test("a checkout's build output is not an install", () => {
    expect(locate(cli("/src/solodev/dist/product"), "/home/u", {})).toBeUndefined()
    expect(locate("/x/solodev-cli.mjs", "/home/u", {})).toBeUndefined()
  })
})

describe("planInit", () => {
  test("creates, then leaves its own files unchanged", async () => {
    expect(await kinds(input({}))).toEqual([
      "create /repo/.claude/agents/shadow-coder.md",
      "create /repo/.claude/agents/shadow-reviewer.md",
    ])
    const written = {
      "/repo/.claude/agents/shadow-coder.md": withHash("shadow-coder.md", "coder\n"),
      "/repo/.claude/agents/shadow-reviewer.md": withHash("shadow-reviewer.md", "old reviewer\n"),
    }
    expect(await kinds(input(written))).toEqual([
      "unchanged /repo/.claude/agents/shadow-coder.md",
      "update /repo/.claude/agents/shadow-reviewer.md",
    ])
  })

  test("keeps a shadow the user edited unless --force", async () => {
    const files = { "/repo/.claude/agents/shadow-coder.md": `${withHash("shadow-coder.md", "coder\n")}my rule\n` }
    expect((await kinds(input(files)))[0]).toBe("edited /repo/.claude/agents/shadow-coder.md")
    expect((await kinds(input(files, { force: true })))[0]).toBe("update /repo/.claude/agents/shadow-coder.md")
  })

  test("an unmarked shadow is ours only if the old installer's manifest vouches for it", async () => {
    const old = "coder v4\n"
    const hash = createHash("sha256").update(old).digest("hex")
    const files = { "/repo/.claude/agents/shadow-coder.md": old }
    expect((await kinds(input(files)))[0]).toBe("edited /repo/.claude/agents/shadow-coder.md")
    const vouched = { ...files, "/repo/.claude/agents/.harness-manifest": `${hash}  shadow-coder.md\n` }
    expect(await kinds(input(vouched))).toContain("update /repo/.claude/agents/shadow-coder.md")
    expect(await kinds(input(vouched))).toContain("delete /repo/.claude/agents/.harness-manifest")
  })

  test("removes the old installer's leftovers, never the feature folders", async () => {
    const files = {
      "/repo/.agents/solodev/solodev-cli.mjs": "",
      "/repo/.agents/skills/.harness-manifest": "",
      "/repo/bin/quest-state": "",
      "/repo/.cursor/skills/sddkit/SKILL.md": "",
      "/home/u/.agents/solodev/acme/app/csv/spec.md": "",
    }
    const ops = await kinds(input(files, { host: "cursor" }))
    expect(ops).toEqual(
      expect.arrayContaining([
        "delete /repo/.agents/solodev/solodev-cli.mjs",
        "delete /repo/.agents/skills/.harness-manifest",
        "delete /repo/bin/quest-state",
        "delete /repo/.cursor/skills/sddkit",
      ]),
    )
    expect(ops.some((op) => op.includes("/home/u/.agents/solodev/acme"))).toBe(false)
  })

  test("global: old CLI under $HOME and the personal defaults move", async () => {
    const files = { "/home/u/.agents/solodev/solodev-cli.mjs": "", "/home/u/.agents/solodev.yaml": "writer: codex\n" }
    const ops = await planInit(input(files, { scope: "global", root: "/home/u", host: "codex" }))
    expect(ops.map((op) => `${op.kind} ${op.path}`)).toEqual([
      "create /home/u/.codex/agents/shadow-coder.toml",
      "create /home/u/.codex/agents/shadow-reviewer.toml",
      "delete /home/u/.agents/solodev/solodev-cli.mjs",
      "move /home/u/.agents/solodev/solodev-conf.yaml",
    ])
    const kept = { ...files, "/home/u/.agents/solodev/solodev-conf.yaml": "writer: claude\n" }
    const again = await planInit(input(kept, { scope: "global", root: "/home/u", host: "codex" }))
    expect(again.some((op) => op.kind === "move")).toBe(false)
  })
})
