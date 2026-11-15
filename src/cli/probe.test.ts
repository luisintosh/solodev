import { describe, expect, test } from "vitest"
import type { Models } from "./models.ts"
import { detectHome, parseDefaults, type ProbeDeps, probe } from "./probe.ts"

const models: Models = {
  claude: {
    think: { id: "claude-opus-5-5", effort: "medium" },
    implement: { id: "claude-sonnet-5-5", effort: "high" },
    shadows: { "shadow-spec-reviewer": { id: "claude-opus-5-5", effort: "high" } },
  },
  codex: {
    think: { id: "gpt-6.1-sol", effort: "max" },
    implement: { id: "gpt-6.1-sol", effort: "medium" },
    shadows: {},
  },
  cursor: {
    think: { id: "grok-4.7", effort: "xhigh" },
    implement: { id: "grok-4.7", effort: "medium" },
    shadows: {},
  },
}

function deps(over: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    env: { CLAUDECODE: "1" },
    root: "/repo",
    state: "/home/u/.agents/solodev/acme/repo",
    home: "/home/u",
    writable: async () => true,
    exec: async (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`
      if (key === "claude auth status") return { code: 0, stdout: '{"loggedIn": true}' }
      if (key === "agent status") return { code: 0, stdout: "✓ Logged in as someone" }
      return { code: 0, stdout: "" }
    },
    which: async () => true,
    exists: async () => true,
    read: async () => undefined,
    ...over,
  }
}

describe("probe", () => {
  test("offers other tools first, then the home tool", async () => {
    const p = await probe(deps(), models)
    expect(p.home).toBe("claude")
    expect(p.writers.map(({ launch, ...w }) => w)).toEqual([
      { tool: "codex", model: "codex/gpt-6.1-sol/medium", recommended: true },
      { tool: "cursor", model: "cursor/grok-4.7/medium", recommended: false },
      { tool: "claude", model: "claude/claude-sonnet-5-5/high", recommended: false },
    ])
    expect(p.writers[0]!.launch).toEqual({ agent: "codex", model: "gpt-6.1-sol", effort: "medium" })
    expect(p.tools.claude.launch.think).toEqual({ agent: "claude", model: "claude-opus-5-5", effort: "medium" })
    expect(p.tools.claude.launch.shadows).toEqual({
      "shadow-spec-reviewer": { agent: "claude", model: "claude-opus-5-5", effort: "high" },
    })
    expect(p.defaults).toEqual({ writer: "ask" })
    expect(p.state).toEqual({ dir: "/home/u/.agents/solodev/acme/repo", writable: true })
    expect(p.warnings).toEqual([])
  })

  test("warns when the home tool has no shadows yet, and finds global ones", async () => {
    const none = await probe(deps({ exists: async (f) => !f.includes("/agents/shadow-") }), models)
    expect(none.tools.claude.shadows).toBe(false)
    expect(none.warnings).toContain("claude has no solodev shadows yet; run /solo-task init")
    const global = await probe(deps({ exists: async (f) => !f.startsWith("/repo/.claude/agents/") }), models)
    expect(global.tools.claude.shadows).toBe(true)
    expect(global.warnings).toEqual([])
  })

  test("warns when this session can't write the state folder", async () => {
    const p = await probe(deps({ writable: async () => false }), models)
    expect(p.state.writable).toBe(false)
    expect(p.warnings).toContain(
      "can't write to /home/u/.agents/solodev/acme/repo; allow it in this tool's sandbox before /solo-task",
    )
  })

  test("a logged-out tool is not offered; one without solodev's skills still is", async () => {
    const base = deps()
    const p = await probe(
      deps({
        exec: async (cmd, args) => (cmd === "codex" ? { code: 1, stdout: "" } : base.exec(cmd, args)),
        exists: async (file) => !file.includes("/skills/"),
      }),
      models,
    )
    expect(p.tools.codex.loggedIn).toBe(false)
    expect(p.tools.cursor.skills).toBe(false)
    expect(p.writers.map((w) => w.tool)).toEqual(["cursor", "claude"])
  })
})

describe("personal defaults", () => {
  const withDefaults = (yaml: string, over: Partial<ProbeDeps> = {}) =>
    deps({
      read: async (file) => (file.endsWith("solodev-conf.yaml") ? yaml : undefined),
      ...over,
    })

  test("the retired dispatch key is a warning", async () => {
    const p = await probe(withDefaults("writer: codex\ndispatch: orca\n"), models)
    expect(p.defaults).toEqual({ writer: "codex" })
    expect(p.warnings.join("\n")).toContain("dispatch is no longer used")
  })

  test("a preferred writer that can't write here is a warning, not a failure", async () => {
    const p = await probe(withDefaults("writer: codex\n", { which: async (bin) => bin !== "codex" }), models)
    expect(p.warnings.join("\n")).toContain("writer: codex is set, but that tool can't write here")
  })

  test("bad values fall back to asking", () => {
    const warnings: string[] = []
    expect(parseDefaults("writer: gemini\n", warnings)).toEqual({ writer: "ask" })
    expect(warnings).toHaveLength(1)
    expect(parseDefaults(": : :", warnings)).toEqual({ writer: "ask" })
  })
})

describe("detectHome", () => {
  test("SOLODEV_HOME wins, then each tool's own variable", () => {
    expect(detectHome({ SOLODEV_HOME: "cursor", CLAUDECODE: "1" })).toBe("cursor")
    expect(detectHome({ CLAUDECODE: "1" })).toBe("claude")
    expect(detectHome({ CURSOR_AGENT: "1" })).toBe("cursor")
    expect(detectHome({ CODEX_SANDBOX: "seatbelt" })).toBe("codex")
    expect(detectHome({ CODEX_HOME: "/x" })).toBe(null)
  })
})
