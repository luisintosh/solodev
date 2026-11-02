#!/usr/bin/env node
/**
 * Prompt quiz (evals/quiz.json): a model reads solodev as installed for Claude Code and answers each scenario and
 * routing query in one call; Haiku grades the answers against their expectations in a second. Both calls run headless
 * from a temp folder with no tools, MCP servers, skills or settings, so only solodev's files are in context.
 *   node tools/quiz.ts [--model <alias>]   answer with <alias> (default sonnet)
 */
import * as fsSync from "node:fs"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { z } from "zod"
import { root, sh } from "./eval-lib.ts"

const quizFile = path.join(root, "evals", "quiz.json")
const resultsFile = path.join(root, "evals", "results", "quiz.jsonl")
// What a Claude Code install holds: the skills from dist/product, and the shadows `solodev init claude` writes.
const skillsDir = path.join(root, "dist", "product", "skills")
const agentsDir = path.join(root, "dist", "claude", "agents")

export const Quiz = z
  .object({
    questions: z
      .array(
        z
          .object({ id: z.string().regex(/^[a-z0-9-]+$/), situation: z.string(), ask: z.string(), expect: z.string() })
          .strict(),
      )
      .min(1),
    routing: z.array(z.object({ query: z.string(), skill: z.string().nullable() }).strict()).min(1),
  })
  .strict()
export type Quiz = z.infer<typeof Quiz>

const Answers = z.object({
  answers: z.array(z.object({ id: z.string(), answer: z.string(), unclear: z.string().nullable().optional() })),
  routing: z.array(z.object({ n: z.number(), skill: z.string().nullable() })),
})
const Verdicts = z.array(z.object({ id: z.string(), pass: z.boolean(), why: z.string() }))
type Answers = z.infer<typeof Answers>
type Verdicts = z.infer<typeof Verdicts>

export async function loadQuiz(file = quizFile): Promise<Quiz> {
  const quiz = Quiz.parse(JSON.parse(await fs.readFile(file, "utf8")))
  const ids = quiz.questions.map((q) => q.id)
  const dup = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dup) throw new Error(`quiz: duplicate id ${dup}`)
  return quiz
}

/** Every Markdown file under `dir`, each under its path (`prefix` + its path in `dir`). */
export async function corpus(dir: string, prefix = ""): Promise<string> {
  const files = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort()
  const parts = await Promise.all(
    files.map(
      async (f) => `<file path="${prefix}${f}">\n${(await fs.readFile(path.join(dir, f), "utf8")).trim()}\n</file>`,
    ),
  )
  return parts.join("\n\n")
}

export function answerPrompt(quiz: Quiz): string {
  return [
    "Answer each scenario as the agent it puts you in, following solodev's files. Say concretely what you do next: the",
    "commands you run, the agents you start and how, the files you write, what you tell or ask the user. Two to five",
    "sentences each. Where the files don't settle a scenario, answer with your best reading and put a one-line note in",
    "`unclear`; otherwise `unclear` is null.",
    "",
    "Then route each user message: the one solodev skill whose description says it should handle the message, or null",
    "when none should. Judge from the descriptions alone, as a coding tool does when it picks a skill.",
    "",
    'Reply with only this JSON: {"answers": [{"id": "...", "answer": "...", "unclear": null}], "routing": [{"n": 1, "skill": "solodev-review"}]}',
    "",
    "<scenarios>",
    ...quiz.questions.map((q) => `[${q.id}]\n${q.situation}\n${q.ask}\n`),
    "</scenarios>",
    "",
    "<messages>",
    ...quiz.routing.map((r, i) => `${i + 1}. ${r.query}`),
    "</messages>",
  ].join("\n")
}

export function judgePrompt(quiz: Quiz, answers: Answers): string {
  const byId = new Map(answers.answers.map((a) => [a.id, a.answer]))
  return [
    "Grade each answer from an AI coding agent against its expectation. Judge what the agent would do, not its wording:",
    "pass when that matches the expectation, even phrased differently or hedged on cases the scenario rules out. Fail",
    "when it misses what the expectation asks for or also does something the expectation rules out.",
    'Reply with only a JSON array: [{"id": "...", "pass": true, "why": "<one line>"}]',
    "",
    ...quiz.questions.map((q) =>
      [
        `<item id="${q.id}">`,
        `<scenario>${q.situation}\n${q.ask}</scenario>`,
        `<expect>${q.expect}</expect>`,
        `<answer>${byId.get(q.id) ?? "(no answer)"}</answer>`,
        "</item>",
      ].join("\n"),
    ),
  ].join("\n")
}

/** Anything loaded besides solodev's files: tools, MCP servers, skills or slash commands in the init event. */
export function leaks(stdout: string): string[] {
  for (const line of stdout.split("\n")) {
    if (!line.includes('"subtype":"init"')) continue
    const init = JSON.parse(line) as Record<string, unknown[] | undefined>
    return ["tools", "mcp_servers", "skills", "slash_commands"].filter((k) => (init[k]?.length ?? 0) > 0)
  }
  return ["no init event"]
}

/** The first JSON object or array in a model's reply. */
export function parseJson(text: string): unknown {
  const start = text.search(/[[{]/)
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"))
  if (start === -1 || end < start) throw new Error("no JSON in the reply")
  return JSON.parse(text.slice(start, end + 1))
}

export type Graded = { id: string; pass: boolean; why: string }

export function grade(quiz: Quiz, answers: Answers, verdicts: Verdicts): { questions: Graded[]; routing: Graded[] } {
  const questions = quiz.questions.map((q) => {
    const v = verdicts.find((x) => x.id === q.id)
    return v ? { id: q.id, pass: v.pass, why: v.why } : { id: q.id, pass: false, why: "no verdict from the judge" }
  })
  const routing = quiz.routing.map((r, i) => {
    const got = answers.routing.find((x) => x.n === i + 1)?.skill
    return {
      id: r.query,
      pass: got === r.skill,
      why: `expected ${r.skill}, got ${got === undefined ? "nothing" : got}`,
    }
  })
  return { questions, routing }
}

type Call = { text: string; leaks: string[]; inputTokens: number; outputTokens: number }

/** One headless turn from an empty temp folder, with `system` replacing Claude Code's system prompt. */
function call(model: string, system: string, prompt: string): Call {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "solodev-quiz-"))
  try {
    const systemFile = path.join(dir, "system.md")
    fsSync.writeFileSync(systemFile, system)
    const r = sh(
      "claude",
      [
        "-p",
        prompt,
        "--model",
        model,
        "--system-prompt-file",
        systemFile,
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--max-turns",
        "1",
        "--output-format",
        "stream-json",
        "--verbose",
      ],
      dir,
      { timeoutMs: 15 * 60_000 },
    )
    const result = r.stdout
      .split("\n")
      .filter((l) => l.includes('"type":"result"'))
      .map(
        (l) =>
          JSON.parse(l) as {
            result?: string
            is_error?: boolean
            usage?: Record<string, number | undefined>
          },
      )
      .pop()
    if (!result || result.is_error) throw new Error(`claude -p failed: ${result?.result ?? r.stderr.slice(-500)}`)
    const u = result.usage ?? {}
    return {
      text: result.result ?? "",
      leaks: leaks(r.stdout),
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    }
  } finally {
    fsSync.rmSync(dir, { recursive: true, force: true })
  }
}

async function main(argv: string[]): Promise<number> {
  const i = argv.indexOf("--model")
  const model = i === -1 ? "sonnet" : argv[i + 1]
  if (!model) throw new Error("usage: node tools/quiz.ts [--model <alias>]")
  if (!fsSync.existsSync(skillsDir)) throw new Error("no dist/product: run `pnpm run build` first")
  const quiz = await loadQuiz()
  const system = [
    "You are an AI coding agent in a user's repository, with solodev installed for Claude Code. These are solodev's",
    "files exactly as installed: each skill's SKILL.md with its references/, and the two subagents, whose skills are",
    "preloaded.",
    "",
    await corpus(skillsDir, "skills/"),
    "",
    await corpus(agentsDir, "agents/"),
  ].join("\n")

  console.log(`quiz: ${quiz.questions.length} scenarios, ${quiz.routing.length} routing queries, answered by ${model}`)
  const answered = call(model, system, answerPrompt(quiz))
  const answers = Answers.parse(parseJson(answered.text))
  const judged = call("haiku", "You grade AI coding agents' answers against expectations.", judgePrompt(quiz, answers))
  const { questions, routing } = grade(quiz, answers, Verdicts.parse(parseJson(judged.text)))

  const leaked = [...new Set([...answered.leaks, ...judged.leaks])]
  const failed = [...questions, ...routing].filter((g) => !g.pass)
  const unclear = answers.answers.filter((a) => a.unclear).map((a) => ({ id: a.id, note: a.unclear! }))
  for (const g of failed) console.log(`  ✗ ${g.id}: ${g.why}`)
  for (const u of unclear) console.log(`  ? ${u.id}: ${u.note}`)
  if (leaked.length) console.log(`  ✗ context leaked into the call: ${leaked.join(", ")}`)
  const pass = (gs: Graded[]) => gs.filter((g) => g.pass).length
  const tokens = {
    inputTokens: answered.inputTokens + judged.inputTokens,
    outputTokens: answered.outputTokens + judged.outputTokens,
  }
  console.log(
    `${failed.length || leaked.length ? "✗" : "✓"} scenarios ${pass(questions)}/${questions.length} · routing ${pass(routing)}/${routing.length} · ${unclear.length} unclear · ${tokens.inputTokens} in / ${tokens.outputTokens} out tokens`,
  )

  const sha = sh("git", ["rev-parse", "--short", "HEAD"], root).stdout.trim()
  const dirty = sh("git", ["status", "--porcelain", "src"], root).stdout.trim() ? "+dirty" : ""
  await fs.mkdir(path.dirname(resultsFile), { recursive: true })
  await fs.appendFile(
    resultsFile,
    `${JSON.stringify({ date: new Date().toISOString(), sha: sha + dirty, model, scenarios: `${pass(questions)}/${questions.length}`, routing: `${pass(routing)}/${routing.length}`, failed: failed.map((g) => g.id), unclear, leaked, ...tokens })}\n`,
  )
  return failed.length || leaked.length ? 1 : 0
}

if (process.argv[1] === import.meta.filename) process.exitCode = await main(process.argv.slice(2))
