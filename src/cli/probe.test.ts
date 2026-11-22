import { describe, expect, test } from "vitest"
import type { Models } from "./models.ts"
import { detectHome, parseDefaults, type ProbeDeps, probe } from "./probe.ts"

const models: Models = {
  claude: { coder: "sonnet/high" },
  codex: { coder: "sol/medium" },
  cursor: { coder: "grok/medium" },
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
    expect(p.writers).toEqual([
      { tool: "codex", coder: "sol/medium", recommended: true },
      { tool: "cursor", coder: "grok/medium", recommended: false },
      { tool: "claude", coder: "sonnet/high", recommended: false },
    ])
    expect(p.tools.claude.coder).toBe("sonnet/high")
    expect(p.defaults).toEqual({ writer: "ask", coder: {} })
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

  test("shadows out of date in a scope send the user to init there", async () => {
    const p = await probe(deps({ stale: async (tool) => (tool === "claude" ? ["project"] : []) }), models)
    expect(p.tools.claude.shadows).toBe(false)
    expect(p.warnings).toEqual(["claude's solodev shadows (project) are out of date; run /solo-task init --project"])
    expect((await probe(deps({ stale: async () => [] }), models)).tools.claude.shadows).toBe(true)
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
    expect(p.defaults).toEqual({ writer: "codex", coder: {} })
    expect(p.warnings.join("\n")).toContain("dispatch is no longer used")
  })

  test("a preferred writer that can't write here is a warning, not a failure", async () => {
    const p = await probe(withDefaults("writer: codex\n", { which: async (bin) => bin !== "codex" }), models)
    expect(p.warnings.join("\n")).toContain("writer: codex is set, but that tool can't write here")
  })

  test("the user's coder replaces the catalog's in the tool row and the writer options", async () => {
    const p = await probe(withDefaults("coder:\n  claude: opus/high\n  codex: session\n"), models)
    expect(p.defaults.coder).toEqual({ claude: "opus/high", codex: "session" })
    expect(p.tools.claude.coder).toBe("opus/high")
    expect(p.tools.cursor.coder).toBe("grok/medium")
    expect(p.writers.map((w) => `${w.tool} ${w.coder}`)).toEqual([
      "codex session",
      "cursor grok/medium",
      "claude opus/high",
    ])
    expect(p.warnings).toEqual([])
  })

  test("a bad coder entry is a warning and keeps the default", async () => {
    const p = await probe(withDefaults("coder:\n  gemini: pro/high\n  claude: ''\n"), models)
    expect(p.tools.claude.coder).toBe("sonnet/high")
    expect(p.warnings.join("\n")).toContain("coder.gemini is not claude, codex or cursor")
    expect(p.warnings.join("\n")).toContain("coder.claude must be <model>/<effort> or session")
    expect((await probe(withDefaults("coder: opus/high\n"), models)).warnings.join("\n")).toContain(
      "coder must map a tool",
    )
  })

  test("bad values fall back to asking", () => {
    const warnings: string[] = []
    expect(parseDefaults("writer: gemini\n", warnings)).toEqual({ writer: "ask", coder: {} })
    expect(warnings).toHaveLength(1)
    expect(parseDefaults(": : :", warnings)).toEqual({ writer: "ask", coder: {} })
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
