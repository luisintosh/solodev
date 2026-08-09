import { describe, expect, test } from "vitest"
import type { Models } from "./models.ts"
import { detectHome, parseDefaults, type ProbeDeps, probe, resolveOrcaCli } from "./probe.ts"

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
    state: "/home/u/.agents/solodev/acme/repo",
    home: "/home/u",
    writable: async () => true,
    exec: async (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`
      if (key === "orca status --json") return { code: 0, stdout: ready }
      if (key === "orca skills installed") return { code: 0, stdout: "agent-browser (1)\norchestration (2)\n" }
      if (key === "claude auth status") return { code: 0, stdout: '{"loggedIn": true}' }
      if (key === "agent status") return { code: 0, stdout: "✓ Logged in as someone" }
      return { code: 0, stdout: "" }
    },
    which: async () => true,
    exists: async () => true,
    read: async (file) => (file.endsWith("AGENTS.md") ? AGENTS : undefined),
    ...over,
  }
}

describe("probe", () => {
  test("offers other tools through Orca first, then the home tool natively", async () => {
    const p = await probe(deps(), models)
    expect(p.home).toBe("claude")
    expect(p.writers.map(({ launch, ...w }) => w)).toEqual([
      { tool: "codex", via: "orca", model: "codex/gpt-6.1-sol/medium", recommended: true },
      { tool: "cursor", via: "orca", model: "cursor/grok-4.7/medium", recommended: false },
      { tool: "claude", via: "native", model: "claude/claude-sonnet-5-5/high", recommended: false },
    ])
    expect(p.writers[0]!.launch).toEqual({ agent: "codex", model: "gpt-6.1-sol", effort: "medium" })
    expect(p.tools.claude.launch.think).toEqual({ agent: "claude", model: "claude-opus-5-5", effort: "medium" })
    expect(p.defaults).toEqual({ writer: "ask", dispatch: "auto" })
    expect(p.agentsMd.missing).toEqual([])
    expect(p.state).toEqual({ dir: "/home/u/.agents/solodev/acme/repo", writable: true })
    expect(p.warnings).toEqual([])
  })

  test("warns when this session can't write the state folder", async () => {
    const p = await probe(deps({ writable: async () => false }), models)
    expect(p.state.writable).toBe(false)
    expect(p.warnings).toContain(
      "can't write to /home/u/.agents/solodev/acme/repo; allow it in this tool's sandbox before /arise",
    )
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

  test("suggests /arise-scout as optional when AGENTS.md is missing", async () => {
    const p = await probe(deps({ read: async () => undefined }), models)
    expect(p.agentsMd.found).toBe(false)
    expect(p.warnings.join("\n")).toMatch(/AGENTS.md not found.*optional: run \/arise-scout/)
  })

  test("flags missing commands and a long AGENTS.md", async () => {
    const long = `## Commands\n- test: \`t\`\n${"line\n".repeat(120)}`
    const p = await probe(deps({ read: async (file) => (file.endsWith("AGENTS.md") ? long : undefined) }), models)
    expect(p.agentsMd.missing).toEqual(["install", "dev", "build", "test_file", "lint", "typecheck"])
    expect(p.warnings.join("\n")).toMatch(/doesn't list install, dev.*optional: run \/arise-scout/)
    expect(p.warnings.join("\n")).toMatch(/AGENTS.md is 1\d\d lines/)
  })
})

describe("personal defaults", () => {
  const withDefaults = (yaml: string, over: Partial<ProbeDeps> = {}) =>
    deps({
      read: async (file) => (file.endsWith("AGENTS.md") ? AGENTS : file.endsWith("solodev.yaml") ? yaml : undefined),
      ...over,
    })

  test("dispatch: orca runs the home tool's coder as an Orca worker too", async () => {
    const p = await probe(withDefaults("writer: codex\ndispatch: orca\n"), models)
    expect(p.defaults).toEqual({ writer: "codex", dispatch: "orca" })
    expect(p.writers.at(-1)).toMatchObject({ tool: "claude", via: "orca" })
  })

  test("a preferred writer that can't write here is a warning, not a failure", async () => {
    const p = await probe(withDefaults("writer: codex\n", { which: async (bin) => bin !== "codex" }), models)
    expect(p.warnings.join("\n")).toContain("writer: codex is set, but that tool can't write here")
  })

  test("bad values fall back to asking", () => {
    const warnings: string[] = []
    expect(parseDefaults("writer: gemini\ndispatch: always\n", warnings)).toEqual({ writer: "ask", dispatch: "auto" })
    expect(warnings).toHaveLength(2)
    expect(parseDefaults(": : :", warnings)).toEqual({ writer: "ask", dispatch: "auto" })
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
