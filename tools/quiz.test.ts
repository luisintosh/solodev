import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"
import { root } from "./eval-lib.ts"
import { answerPrompt, corpus, grade, judgePrompt, leaks, loadQuiz, parseJson, type Quiz } from "./quiz.ts"

const quiz: Quiz = {
  questions: [
    { id: "a", situation: "S", ask: "A?", expect: "E" },
    { id: "b", situation: "S", ask: "B?", expect: "E" },
  ],
  routing: [
    { query: "review my branch", skill: "solodev-review" },
    { query: "fix a typo", skill: null },
  ],
}

describe("evals/quiz.json", () => {
  it("parses, and routes only to skills in the catalog", async () => {
    const q = await loadQuiz()
    const catalog = parseYaml(await fs.readFile(path.join(root, "src", "catalog.yaml"), "utf8")) as {
      skills: Record<string, unknown>
    }
    for (const r of q.routing) if (r.skill) expect(Object.keys(catalog.skills)).toContain(r.skill)
  })

  it("rejects a duplicate id", async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "quiz-")), "quiz.json")
    await fs.writeFile(file, JSON.stringify({ ...quiz, questions: [quiz.questions[0], quiz.questions[0]] }))
    await expect(loadQuiz(file)).rejects.toThrow("duplicate id a")
  })
})

describe("prompts", () => {
  it("number the routing queries and carry each question's expectation to the judge only", () => {
    expect(answerPrompt(quiz)).toContain("2. fix a typo")
    expect(answerPrompt(quiz)).not.toContain("<expect>")
    const judge = judgePrompt(quiz, { answers: [{ id: "a", answer: "did A" }], routing: [] })
    expect(judge).toContain("<expect>E</expect>")
    expect(judge).toContain("<answer>did A</answer>")
    expect(judge).toContain("<answer>(no answer)</answer>")
  })

  it("inline every installed file under its path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quiz-"))
    await fs.mkdir(path.join(dir, "skills", "x", "references"), { recursive: true })
    await fs.writeFile(path.join(dir, "skills", "x", "SKILL.md"), "body\n")
    await fs.writeFile(path.join(dir, "skills", "x", "references", "r.md"), "ref\n")
    expect(await corpus(dir)).toBe(
      '<file path="skills/x/SKILL.md">\nbody\n</file>\n\n<file path="skills/x/references/r.md">\nref\n</file>',
    )
  })
})

describe("grade", () => {
  it("takes the judge's verdicts, fails a missing one, and matches routing exactly", () => {
    const g = grade(
      quiz,
      {
        answers: [],
        routing: [
          { n: 1, skill: "solodev-review" },
          { n: 2, skill: "solodev-mission" },
        ],
      },
      [{ id: "a", pass: true, why: "ok" }],
    )
    expect(g.questions.map((q) => q.pass)).toEqual([true, false])
    expect(g.questions[1]!.why).toBe("no verdict from the judge")
    expect(g.routing.map((r) => r.pass)).toEqual([true, false])
  })
})

describe("leaks", () => {
  const init = (o: object) => JSON.stringify({ type: "system", subtype: "init", ...o })
  it("names what the call loaded besides solodev", () => {
    expect(leaks(init({ tools: [], mcp_servers: [], skills: [], slash_commands: [] }))).toEqual([])
    expect(leaks(init({ tools: ["Bash"], mcp_servers: [{ name: "x" }], skills: [] }))).toEqual(["tools", "mcp_servers"])
    expect(leaks("")).toEqual(["no init event"])
  })
})

describe("parseJson", () => {
  it("finds the JSON in a reply and throws when there is none", () => {
    expect(parseJson('Here:\n```json\n{"a": [1]}\n```')).toEqual({ a: [1] })
    expect(parseJson('[{"id": "a"}] done')).toEqual([{ id: "a" }])
    expect(() => parseJson("no json")).toThrow("no JSON")
  })
})
