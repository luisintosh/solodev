import { describe, expect, test } from "vitest"
import { formatCoders, parseCoderArgs, withCoder } from "./coder.ts"

describe("parseCoderArgs", () => {
  test("a tool, a value, both, or neither", () => {
    expect(parseCoderArgs([])).toEqual({})
    expect(parseCoderArgs(["codex"])).toEqual({ tool: "codex" })
    expect(parseCoderArgs(["opus/high"])).toEqual({ value: "opus/high" })
    expect(parseCoderArgs(["codex", "sol/xhigh"])).toEqual({ tool: "codex", value: "sol/xhigh" })
  })

  test("refuses an unknown tool, a blank value or too many words", () => {
    expect(() => parseCoderArgs(["gemini", "pro/high"])).toThrow(/unknown tool/)
    expect(() => parseCoderArgs(["claude", " "])).toThrow(/isn't a coder/)
    expect(() => parseCoderArgs(["claude", "opus", "high"])).toThrow(/usage/)
  })
})

describe("withCoder", () => {
  test("sets a tool's coder, keeping comments and other keys", () => {
    const raw = "# mine\nwriter: codex # pick codex\n"
    const out = withCoder(raw, "claude", "opus/high")
    expect(out).toContain("# mine")
    expect(out).toContain("writer: codex # pick codex")
    expect(out).toMatch(/coder:\n {2}claude: opus\/high/)
  })

  test("replaces a value and removes it for default, dropping an empty coder map", () => {
    const set = withCoder("coder:\n  claude: sonnet/high\n  codex: sol/high\n", "claude", "opus/max")
    expect(set).toContain("claude: opus/max")
    const one = withCoder(set, "claude", "default")
    expect(one).not.toContain("claude")
    expect(one).toContain("codex: sol/high")
    expect(withCoder("writer: ask\ncoder:\n  codex: session\n", "codex", "default")).toBe("writer: ask\n")
  })

  test("starts a missing or empty file", () => {
    expect(withCoder(undefined, "cursor", "session")).toBe("coder:\n  cursor: session\n")
    expect(withCoder("", "cursor", "default")).toBe("")
  })

  test("refuses a file that isn't YAML", () => {
    expect(() => withCoder("coder: [", "claude", "opus/high")).toThrow(/valid YAML/)
  })
})

describe("formatCoders", () => {
  const models = {
    claude: { coder: "sonnet/high" },
    codex: { coder: "sol/high" },
    cursor: { coder: "grok/high" },
  }

  test("shows the user's value beside the default", () => {
    const out = formatCoders(models, { claude: "opus/high" })
    expect(out).toMatch(/claude\s+opus\/high\s+\(yours; default sonnet\/high\)/)
    expect(out).toMatch(/codex\s+sol\/high\s+\(default\)/)
    expect(formatCoders(models, {}, "cursor").split("\n")).toHaveLength(1)
  })
})
