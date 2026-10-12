import { describe, expect, test } from "vitest"
import type { Models } from "./models.ts"
import { detectHome, type ProbeDeps, probe, resolveOrcaCli } from "./probe.ts"

const models: Models = {
  claude: {
    think: { id: "claude-opus-5-5", effort: "medium" },
    implement: { id: "claude-sonnet-5-5", effort: "high" },
  },
  codex: { think: { id: "gpt-6.1-sol", effort: "max" }, implement: { id: "gpt-6.1-sol", effort: "medium" } },
  cursor: { think: { id: "grok-4.7", effort: "xhigh" }, implement: { id: "grok-4.7", effort: "medium" } },
}

const ready = JSON.stringify({ ok: true, result: { runtime: { state: "ready" } } })
const AGENTS =
  "## Commands\n\n- install: n/a\n- dev: n/a\n- build: `b`\n- test: `t`\n- test_file: `t {file}`\n- lint: n/a\n- typecheck: n/a\n"

function deps(over: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    env: { CLAUDECODE: "1" },
    platform: "darwin",
    root: "/repo",
    home: "/home/u",
    exec: async (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`
      if (key === "orca status --json") return { code: 0, stdout: ready }
      if (key === "orca skills installed") return { code: 0, stdout: "agent-browser (1)\norchestration (2)\n" }
      if (key === "claude auth status") return { code: 0, stdout: '{"loggedIn": true}' }
      if (key === "cursor-agent status") return { code: 0, stdout: "✓ Logged in as someone" }
      return { code: 0, stdout: "" }
    },
    which: async () => true,
    exists: async () => true,
    read: async () => AGENTS,
    ...over,
  }
}

describe("probe", () => {
  test("offers other tools through Orca first, then the home tool natively", async () => {
    const p = await probe(deps(), models)
    expect(p.home).toBe("claude")
    expect(p.writers).toEqual([
      { tool: "codex", via: "orca", model: "codex/gpt-6.1-sol/medium", recommended: true },
      { tool: "cursor", via: "orca", model: "cursor/grok-4.7/medium", recommended: false },
      { tool: "claude", via: "native", model: "claude/claude-sonnet-5-5/high", recommended: false },
    ])
    expect(p.agentsMd.missing).toEqual([])
    expect(p.warnings).toEqual([])
  })

  test("without Orca's orchestration skill only the home tool can write", async () => {
    const base = deps()
    const p = await probe(
      deps({
        exec: async (cmd, args) =>
          args.join(" ") === "skills installed" ? { code: 0, stdout: "agent-browser (1)\n" } : base.exec(cmd, args),
      }),
      models,
    )
    expect(p.orca.ready).toBe(false)
    expect(p.orca.reason).toContain("orchestration skill")
    expect(p.writers.map((w) => `${w.tool} ${w.via}`)).toEqual(["claude native"])
  })

  test("a tool that is logged out or lacks solodev's skills is not offered", async () => {
    const base = deps()
    const p = await probe(
      deps({
        exec: async (cmd, args) => (cmd === "codex" ? { code: 1, stdout: "" } : base.exec(cmd, args)),
        exists: async (file) => !file.includes(".agents/skills") || file.startsWith("/home/u"),
      }),
      models,
    )
    expect(p.tools.codex.loggedIn).toBe(false)
    expect(p.writers.map((w) => w.tool)).toEqual(["cursor", "claude"])
  })

  test("flags missing commands and a long AGENTS.md", async () => {
    const long = `## Commands\n- test: \`t\`\n${"line\n".repeat(120)}`
    const p = await probe(deps({ read: async () => long }), models)
    expect(p.agentsMd.missing).toEqual(["install", "dev", "build", "test_file", "lint", "typecheck"])
    expect(p.warnings.join("\n")).toMatch(/missing install, dev/)
    expect(p.warnings.join("\n")).toMatch(/AGENTS.md is 1\d\d lines/)
  })
})

describe("detectHome / resolveOrcaCli", () => {
  test("SOLODEV_HOME wins, then each tool's own variable", () => {
    expect(detectHome({ SOLODEV_HOME: "cursor", CLAUDECODE: "1" })).toBe("cursor")
    expect(detectHome({ CLAUDECODE: "1" })).toBe("claude")
    expect(detectHome({ CURSOR_AGENT: "1" })).toBe("cursor")
    expect(detectHome({ CODEX_SANDBOX: "seatbelt" })).toBe("codex")
    expect(detectHome({ CODEX_HOME: "/x" })).toBe(null)
  })

  test("orca cli resolution matches the orchestration skill", () => {
    expect(resolveOrcaCli({ ORCA_CLI_COMMAND: "o" }, "darwin")).toBe("o")
    expect(resolveOrcaCli({}, "linux")).toBe("orca-ide")
    expect(resolveOrcaCli({}, "darwin")).toBe("orca")
  })
})
