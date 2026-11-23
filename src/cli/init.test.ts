import { describe, expect, test } from "vitest"
import {
  type AgentFiles,
  agentsDir,
  formatInit,
  type InitInput,
  intact,
  locate,
  planInit,
  staleScopes,
  stripHash,
  withHash,
} from "./init.ts"

const agents: AgentFiles = {
  claude: { "shadow-coder.md": "coder\n", "shadow-other.md": "other\n" },
  codex: { "shadow-coder.toml": 'name = "shadow-coder"\n', "shadow-other.toml": 'name = "shadow-other"\n' },
  cursor: { "shadow-coder.md": "coder\n", "shadow-other.md": "other\n" },
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
    inside: async () => true,
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
  const cli = (base: string) => `${base}/skills/solo-task/scripts/solodev-cli.mjs`
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
      "create /repo/.claude/agents/shadow-other.md",
    ])
    const written = {
      "/repo/.claude/agents/shadow-coder.md": withHash("shadow-coder.md", "coder\n"),
      "/repo/.claude/agents/shadow-other.md": withHash("shadow-other.md", "old other\n"),
    }
    expect(await kinds(input(written))).toEqual([
      "unchanged /repo/.claude/agents/shadow-coder.md",
      "update /repo/.claude/agents/shadow-other.md",
    ])
  })

  test("keeps a shadow the user edited unless --force", async () => {
    const files = { "/repo/.claude/agents/shadow-coder.md": `${withHash("shadow-coder.md", "coder\n")}my rule\n` }
    expect((await kinds(input(files)))[0]).toBe("edited /repo/.claude/agents/shadow-coder.md")
    expect((await kinds(input(files, { force: true })))[0]).toBe("update /repo/.claude/agents/shadow-coder.md")
  })

  test("an unmarked shadow at a shadow's path is treated as edited", async () => {
    const files = { "/repo/.claude/agents/shadow-coder.md": "someone else's coder\n" }
    expect((await kinds(input(files)))[0]).toBe("edited /repo/.claude/agents/shadow-coder.md")
  })

  test("global codex follows CODEX_HOME", async () => {
    const ops = await kinds(input({}, { scope: "global", root: "/home/u", host: "codex", env: { CODEX_HOME: "/c" } }))
    expect(ops).toEqual(["create /c/agents/shadow-coder.toml", "create /c/agents/shadow-other.toml"])
  })

  test("a project init leaves alone a shadows folder a symlink leads outside the repo", async () => {
    const inside = async (p: string) => !p.startsWith("/repo/.cursor/")
    expect(await kinds(input({}, { host: "cursor", inside }))).toEqual([
      "outside /repo/.cursor/agents/shadow-coder.md",
      "outside /repo/.cursor/agents/shadow-other.md",
    ])
  })

  test("removes a retired shadow it wrote, keeps one the user changed or didn't come from init", async () => {
    const files = {
      "/repo/.claude/agents/shadow-reviewer.md": withHash("shadow-reviewer.md", "old reviewer\n"),
      "/repo/.claude/agents/shadow-verifier.md": `${withHash("shadow-verifier.md", "old verifier\n")}my rule\n`,
      "/repo/.claude/agents/shadow-spec-reviewer.md": "someone's own\n",
      "/home/u/.claude/agents/shadow-reviewer.md": withHash("shadow-reviewer.md", "old reviewer\n"),
    }
    expect((await kinds(input(files))).slice(2)).toEqual([
      "kept /repo/.claude/agents/shadow-spec-reviewer.md",
      "remove /repo/.claude/agents/shadow-reviewer.md",
      "kept /repo/.claude/agents/shadow-verifier.md",
    ])
    const outside = await kinds(input(files, { inside: async () => false }))
    expect(outside.some((op) => op.startsWith("remove") || op.startsWith("kept"))).toBe(false)
  })

  test("removes a retired codex shadow and says why a kept one stays", async () => {
    const files = {
      "/repo/.codex/agents/shadow-reviewer.toml": withHash("shadow-reviewer.toml", 'name = "shadow-reviewer"\n'),
      "/repo/.codex/agents/shadow-verifier.toml": "my own verifier\n",
      "/repo/.codex/agents/shadow-spec-reviewer.toml": `# mine\n${withHash("shadow-spec-reviewer.toml", "old\n")}`,
    }
    const args = input(files, { host: "codex" })
    const ops = await planInit(args)
    expect(ops.filter((op) => op.kind === "remove").map((op) => op.path)).toEqual([
      "/repo/.codex/agents/shadow-reviewer.toml",
    ])
    const report = formatInit(args, ops, false)
    expect(report).toMatch(/kept\s+\.codex\/agents\/shadow-verifier\.toml — a retired name, but init didn't write it/)
    expect(report).toMatch(/kept\s+\.codex\/agents\/shadow-spec-reviewer\.toml — retired, but you changed it/)
  })
})

describe("staleScopes", () => {
  test("names the scopes where init would update or remove a shadow", async () => {
    const coder = withHash("shadow-coder.md", "coder\n")
    const other = withHash("shadow-other.md", "other\n")
    const files = {
      "/repo/.claude/agents/shadow-coder.md": coder,
      "/repo/.claude/agents/shadow-other.md": other,
      "/repo/.claude/agents/shadow-reviewer.md": withHash("shadow-reviewer.md", "old\n"),
      "/home/u/.claude/agents/shadow-coder.md": coder,
      "/home/u/.claude/agents/shadow-other.md": other,
    }
    const project = input(files)
    const global = input(files, { scope: "global", root: "/home/u" })
    expect(await staleScopes([project, global])).toEqual(["project"])
    expect(await staleScopes([input({}), input({}, { scope: "global", root: "/home/u" })])).toEqual([])
  })
})
