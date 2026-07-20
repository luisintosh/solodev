import { describe, expect, test } from "vitest"
import { parseCommands, parsePlan, parseQa, parseReview, parseScenarios } from "./feature.ts"
import { helpText, HELP } from "./help.ts"

describe("parseScenarios", () => {
  test("unique ids in order of first appearance", () => {
    expect(parseScenarios("@S2 given\n@S1 when @S2 again\n@S10")).toEqual(["S2", "S1", "S10"])
  })
})

describe("parsePlan", () => {
  const plan = (yaml: string) => `# Plan\n\nApproach.\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`

  test("reads journeys and uncovered scenarios, with or without @", () => {
    expect(
      parsePlan(
        plan(
          "journeys:\n  - id: J1\n    scenarios: [S1, '@S2']\n    test: t/a.test.js\n    command: node t/a.test.js\nuncovered: [S3]",
        ),
      ),
    ).toEqual({
      journeys: [{ id: "J1", scenarios: ["S1", "S2"], test: "t/a.test.js", command: "node t/a.test.js" }],
      uncovered: ["S3"],
    })
  })

  test("skips other fenced blocks", () => {
    const md = "```yaml\nother: 1\n```\n\n```yaml\njourneys: []\n```\n"
    expect(parsePlan(md)).toEqual({ journeys: [], uncovered: [] })
  })

  test("names the missing field", () => {
    expect(() => parsePlan(plan("journeys:\n  - id: J1\n    scenarios: [S1]"))).toThrow(/missing test, command/)
  })

  test("no journeys block is an error an agent can act on", () => {
    expect(() => parsePlan("# Plan\n")).toThrow(/no fenced YAML block starting with `journeys:`/)
  })
})

describe("parseCommands", () => {
  test("first backticked span is the command; n/a maps to null", () => {
    const md = [
      "# Repo",
      "",
      "## Commands",
      "",
      "- install: `pnpm install`",
      "- test: `pnpm test` (all tests)",
      "- test_file: `pnpm vitest run {file}` (one test file)",
      "- lint: n/a",
      "- typecheck: `n/a`",
      "",
      "## Conventions",
      "- style: `ignored`",
    ].join("\n")
    expect(Object.fromEntries(parseCommands(md))).toEqual({
      install: "pnpm install",
      test: "pnpm test",
      test_file: "pnpm vitest run {file}",
      lint: null,
      typecheck: null,
    })
  })

  test("no Commands section → nothing", () => {
    expect(parseCommands("# Repo\n- test: `x`").size).toBe(0)
  })
})

describe("parseReview / parseQa", () => {
  test("review table rows", () => {
    const md = [
      "| id | severity | location | status | finding |",
      "| --- | --- | --- | --- | --- |",
      "| R1 | Major | src/a.ts:3 | open | swallows the error |",
      "| R2 | minor | src/b.ts:9 | deferred | naming |",
    ].join("\n")
    expect(parseReview(md)).toEqual([
      { id: "R1", severity: "major", location: "src/a.ts:3", status: "open", summary: "swallows the error" },
      { id: "R2", severity: "minor", location: "src/b.ts:9", status: "deferred", summary: "naming" },
    ])
  })

  test("qa verdicts keyed by scenario", () => {
    const md = "| scenario | verdict | evidence |\n|---|---|---|\n| @S3 | pass | screenshot /tmp/qa/s3.png |"
    expect(parseQa(md).get("S3")).toEqual({ verdict: "pass", evidence: "screenshot /tmp/qa/s3.png" })
  })
})

describe("help", () => {
  test("lists every command, and each command has usage and an example", () => {
    const list = helpText()
    for (const [name, h] of Object.entries(HELP)) {
      expect(list).toContain(`  ${name}`)
      expect(helpText(name)).toContain(h.usage)
      expect(helpText(name)).toContain(`Example: ${h.example}`)
    }
  })
})
