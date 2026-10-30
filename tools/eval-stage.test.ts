import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sh } from "./eval-lib.ts"
import { changedPrompts, grade, parseTranscript } from "./eval-stage.ts"

const line = (o: unknown) => JSON.stringify(o)
const assistant = (content: unknown[], parent: string | null = null) =>
  line({ type: "assistant", parent_tool_use_id: parent, message: { content } })

const stream = [
  line({ type: "system", subtype: "init" }),
  assistant([{ type: "tool_use", name: "Bash", input: { command: ".agents/solodev/solodev-cli.mjs status greet" } }]),
  assistant([{ type: "tool_use", name: "Read", input: { file_path: "/x/greet/progress.md" } }]),
  assistant([{ type: "text", text: "spec ✓ · gate ✓ · implement ✓ · **review** · pr" }]),
  assistant([{ type: "tool_use", name: "Agent", input: { subagent_type: "shadow-reviewer" } }]),
  assistant([{ type: "tool_use", name: "Edit", input: { file_path: "src/a.js" } }], "toolu_1"),
  assistant([{ type: "text", text: "Two questions?\n1. Who?\n2. When?" }]),
  line({ type: "result", subtype: "success", num_turns: 7, total_cost_usd: 0.4 }),
].join("\n")

describe("parseTranscript", () => {
  it("keeps the commander's events and drops subagents'", () => {
    const t = parseTranscript(stream)
    expect(t.turns).toBe(7)
    expect(t.subtype).toBe("success")
    expect(t.events.map((e) => ("tool" in e ? e.tool : "text"))).toEqual(["Bash", "Read", "text", "Agent", "text"])
  })
})

describe("grade", () => {
  let ws: string
  let state: string
  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "stage-grade-"))
    state = path.join(ws, ".solodev-state")
    const feature = path.join(state, path.basename(ws), "greet")
    await fs.mkdir(feature, { recursive: true })
    await fs.writeFile(
      path.join(feature, "review.md"),
      "| id | severity | location | status | finding |\n| --- | --- | --- | --- | --- |\n| R1 | major | src/index.js:5 | open | prints undefined without --name |\n| R2 | minor | x | open | style |\n",
    )
    for (const args of [
      ["init", "-q", "-b", "main"],
      ["config", "user.email", "e@x"],
      ["config", "user.name", "e"],
    ])
      sh("git", args, ws)
    await fs.writeFile(path.join(ws, ".gitignore"), ".solodev-state/\n")
    sh("git", ["add", "-A"], ws)
    sh("git", ["commit", "-q", "-m", "init"], ws)
  })
  afterEach(() => fs.rm(ws, { recursive: true, force: true }))

  it("grades files, git, tools, replies, commands and counts", async () => {
    const base = sh("git", ["rev-parse", "HEAD"], ws).stdout.trim()
    const graded = await grade(
      [
        { expect: "status before Agent", tool: "Bash", input: "solodev(-cli)?(\\.mjs)? status", before: "Agent" },
        { expect: "Edit before Agent", tool: "Edit", before: "Agent" },
        { expect: "no coder", tool: "Agent", input: "shadow-coder", count: { max: 0 } },
        { expect: "major on --name", file: "{feature}/review.md", matches: "^(?=.*\\bmajor\\b)(?=.*--name).*\\|" },
        { expect: "no roadmaps", file: "{state}/roadmaps", count: { max: 0 } },
        { expect: "one feature", features: true, count: { min: 1, max: 1 } },
        { expect: "no commits", git: ["log", "--oneline", "{base}..HEAD"], count: { max: 0 } },
        { expect: "bar", reply: "implement\\W{0,4}✓" },
        { expect: "≤1 question", reply: "\\?\\s*$", final: true, count: { max: 1 } },
        { expect: "base expands", contract: true, run: ["git", "cat-file", "-e", "{base}"] },
        { expect: "review is there", run: ["test", "-f", "{feature}/review.md"] },
        { expect: "exit code", run: ["git", "cat-file", "-e", "nope"], exit: 128 },
        { expect: "judged", judge: true },
      ],
      parseTranscript(stream),
      { ws, state, base },
    )
    expect(graded.filter((g) => g.contract).map((g) => g.expect)).toEqual(["base expands"])
    expect(graded.map((g) => [g.expect, g.pass])).toEqual([
      ["status before Agent", true],
      // The Edit came from a subagent, so the commander made none.
      ["Edit before Agent", false],
      ["no coder", true],
      ["major on --name", true],
      ["no roadmaps", true],
      ["one feature", true],
      ["no commits", true],
      ["bar", true],
      // Three lines end in "?": over the cap.
      ["≤1 question", false],
      ["base expands", true],
      ["review is there", true],
      ["exit code", true],
      ["judged", null],
    ])
  })
})

describe("changedPrompts", () => {
  it("maps skills, shadows and stage folders, and widens shared sources to every stage", () => {
    expect([...changedPrompts(["src/prompts/skills/solodev-roadmap/SKILL.md", "README.md"])]).toEqual([
      "solodev-roadmap",
    ])
    expect([...changedPrompts(["src/prompts/agents/shadow-reviewer.md", "evals/stages/gate-stop/stage.json"])]).toEqual(
      ["shadow-reviewer", "stage:gate-stop"],
    )
    expect(changedPrompts(["src/prompts/fragments/practices.md"]).has("*")).toBe(true)
    expect(changedPrompts(["src/cli/status.ts"]).has("*")).toBe(true)
    expect(changedPrompts(["src/cli/status.test.ts"]).size).toBe(0)
  })
})
