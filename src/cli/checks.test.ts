import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { approve } from "./approve.ts"
import { baseFailure, type CheckId, type CheckSet, runCheck, runChecks } from "./checks.ts"
import { parseApprovals } from "./feature.ts"
import { featureStatus, type PrInfo } from "./status.ts"

const AGENTS = `# Fixture

## Commands

- install: n/a
- dev: n/a
- build: \`node -e "process.exit(0)"\`
- test: \`node test/hello.test.js\`
- test_file: \`node {file}\`
- lint: n/a
- typecheck: n/a
`

const SPEC = `# Hello

## Acceptance

- @S1 Given nothing, when I call hello, then it returns "hello".
- @S2 Given a name, when I call hello with it, then it greets that name.
`

const plan = (uncovered = "") => `# Plan

Add \`src/hello.js\`.

\`\`\`yaml
journeys:
  - id: J1
    scenarios: [S1${uncovered ? "" : ", S2"}]
    test: test/hello.test.js
    command: node test/hello.test.js
${uncovered ? `uncovered: [${uncovered}]\n` : ""}\`\`\`
`

const TEST = `import assert from "node:assert"
import { hello } from "../src/hello.js"
assert.strictEqual(hello(), "hello")
assert.strictEqual(hello("ana"), "hello ana")
`

const IMPL = `export const hello = (name) => (name ? \`hello \${name}\` : "hello")\n`

let root: string
/** The repo's state folder; the feature folder is `${state}/hello`. */
let state: string
let dir: string

function sh(...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
}

function write(rel: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), content)
}

/** Writes into the feature folder, outside the repo. */
function feat(rel: string, content: string) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}

function commit(message: string, ...paths: string[]) {
  sh("add", "--", ...(paths.length ? paths : ["."]))
  sh("commit", "-q", "-m", message)
}

const check = (id: CheckId, set: CheckSet = "done") => runCheck(id, { root, dir, set, timeoutMs: 30_000 })

async function gate(planText = plan()) {
  feat("spec.md", SPEC)
  feat("plan.md", planText)
  return approve({ root, dir, date: "2026-10-12" })
}

function implement() {
  write("test/hello.test.js", TEST)
  write("src/hello.js", IMPL)
  commit("feat: add hello", "test", "src")
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "solodev-test-"))
  state = fs.mkdtempSync(path.join(os.tmpdir(), "solodev-state-"))
  dir = path.join(state, "hello")
  sh("init", "-q", "-b", "main")
  sh("config", "user.email", "t@example.com")
  sh("config", "user.name", "t")
  sh("config", "commit.gpgsign", "false")
  write("AGENTS.md", AGENTS)
  write("package.json", '{"type":"module"}\n')
  commit("chore: init")
  sh("checkout", "-q", "-b", "feat/hello")
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(state, { recursive: true, force: true })
})

describe("approve", () => {
  test("appends the approval line to progress.md and commits nothing", async () => {
    feat("progress.md", "## Request\n\nhello")
    const head = sh("rev-parse", "HEAD")
    const approval = await gate()
    expect(approval.at).toBe(sh("rev-parse", "--short=12", "HEAD").trim())
    const progress = fs.readFileSync(path.join(dir, "progress.md"), "utf8")
    expect(progress).toBe(`## Request\n\nhello\n- approved 2026-10-12 · spec ${approval.spec} · at ${approval.at}\n`)
    expect(parseApprovals(progress)).toEqual([approval])
    expect(sh("rev-parse", "HEAD")).toBe(head)
    expect(sh("status", "--porcelain")).toBe("")
  })

  test("refuses a plan that leaves a scenario unclaimed", async () => {
    feat("spec.md", `${SPEC}- @S3 a third one\n`)
    feat("plan.md", plan())
    await expect(approve({ root, dir })).rejects.toThrow(/no journey or uncovered entry claims S3/)
  })

  test("refuses while code is staged", async () => {
    write("src/early.js", "export {}\n")
    sh("add", "src/early.js")
    feat("spec.md", SPEC)
    feat("plan.md", plan())
    await expect(approve({ root, dir })).rejects.toThrow(/staged files: src\/early.js/)
  })
})

describe("checks", () => {
  test("a run that follows the workflow passes every implement and pr check but review", async () => {
    await gate()
    implement()
    const results = await runChecks({ root, dir, set: "pr", timeoutMs: 30_000 })
    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]))
    expect(byId).toEqual({
      C1: "pass",
      C2: "pass",
      C3: "pass",
      C4: "pass",
      C5: "pass",
      C6: "pass",
      C7: "fail",
      C9: "pass",
    })
  })

  test("C1 skips an unlisted command and shows a failing one's output", async () => {
    write("AGENTS.md", AGENTS.replace("- lint: n/a\n", "").replace("process.exit(0)", "process.exit(3)"))
    const r = await check("C1", "pr")
    expect(r.status).toBe("fail")
    expect(r.summary).toContain("lint not listed")
    expect(r.summary).toContain("build FAIL")
    expect(r.details.join("\n")).toMatch(/lint not in AGENTS.md.*optional: \/solodev-scout/)
  })

  test("C1 passes with an unlisted command when the listed ones pass", async () => {
    write("AGENTS.md", AGENTS.replace("- lint: n/a\n", ""))
    const r = await check("C1", "implement")
    expect(r.status).toBe("pass")
    expect(r.summary).toContain("lint not listed")
  })

  test("C1 skips without AGENTS.md and suggests /solodev-scout as optional", async () => {
    fs.rmSync(path.join(root, "AGENTS.md"))
    const r = await check("C1", "pr")
    expect(r.status).toBe("skip")
    expect(r.summary).toMatch(/optional: \/solodev-scout/)
  })

  test("C2 requires each journey's test file once past the gate", async () => {
    await gate()
    const r = await check("C2")
    expect(r.status).toBe("fail")
    expect(r.summary).toContain("test file test/hello.test.js does not exist")
  })

  test("C3 fails a test that already passes before the feature", async () => {
    write("src/hello.js", IMPL)
    commit("chore: hello existed before", "src")
    sh("branch", "-f", "main", "HEAD")
    await gate()
    write("test/hello.test.js", TEST)
    commit("test: hello", "test")
    const r = await check("C3")
    expect(r.status).toBe("fail")
    expect(r.summary).toContain("J1 passes at base")
  })

  test("C3 proves red then green and shows the failure before the feature", async () => {
    await gate()
    implement()
    const r = await check("C3")
    expect(r.status).toBe("pass")
    expect(r.summary).toBe("J1 red (new src/hello.js)→green")
    expect(r.evidence?.join("\n")).toMatch(/loading new code[\s\S]*(Cannot find module|ERR_MODULE_NOT_FOUND)/)
  })

  test("C3 reports a failed assertion before the feature as plain red then green", async () => {
    write("src/hello.js", `export const hello = () => "hi"\n`)
    commit("feat: hi", "src")
    sh("branch", "-f", "main", "HEAD")
    await gate()
    implement()
    const r = await check("C3")
    expect(r.status).toBe("pass")
    expect(r.summary).toBe("J1 red→green")
    expect(r.evidence?.join("\n")).toMatch(/expected: 'hello'/)
  })

  test("C3 warns when the test failed to load on a file the feature doesn't touch", async () => {
    write(".gitignore", "src/gen.js\n")
    commit("chore: ignore generated code", ".gitignore")
    sh("branch", "-f", "main", "HEAD")
    await gate()
    write("src/gen.js", `export const greeting = "hello"\n`)
    write("test/hello.test.js", `import { greeting } from "../src/gen.js"\n${TEST}`)
    write("src/hello.js", IMPL)
    commit("feat: add hello", "test", "src/hello.js")
    const r = await check("C3")
    expect(r.status).toBe("warn")
    expect(r.summary).toBe("J1 didn't load at base")
    expect(r.details.join("\n")).toMatch(/src\/gen\.js.*names nothing the feature adds/)
  })

  test("C3 fails a journey whose command can't run before the feature", async () => {
    await gate(plan().replace("command: node test/hello.test.js", "command: sh scripts/t.sh"))
    write("scripts/t.sh", "node test/hello.test.js\n")
    implement()
    commit("test: runner", "scripts")
    const r = await check("C3")
    expect(r.status).toBe("fail")
    expect(r.summary).toBe("J1 never ran at base")
  })

  test("C3 skips the base run for a journey that fails now", async () => {
    await gate()
    write("test/hello.test.js", TEST)
    write("src/hello.js", `export const hello = () => "hi"\n`)
    commit("feat: wip", "test", "src")
    const r = await check("C3")
    expect(r.status).toBe("fail")
    expect(r.summary).toBe("J1 FAILS now")
    expect(r.evidence).toEqual([])
  })

  test.each([
    ["vitest", 'Error: Failed to resolve import "../src/export" from "test/export.test.ts"', ["src/export.ts"], "new"],
    ["pytest", "E   ModuleNotFoundError: No module named 'app.export'", ["app/export.py"], "new"],
    ["pytest package", "E   ModuleNotFoundError: No module named 'app'", ["app/__init__.py"], "new"],
    [
      "node",
      "SyntaxError: The requested module '../src/util.js' does not provide an export named 'greet'",
      ["src/util.js"],
      "new",
    ],
    ["jest", "SyntaxError: Unexpected token ')' in test/hello.test.js", ["src/hello.js"], "load"],
    ["a prefix only", "Error: Cannot find module '../src/hello-world'", ["src/hello.js"], "load"],
    ["an assertion", "AssertionError: expected 'hi' to equal 'hello'", ["src/hello.js"], "behavior"],
  ])("baseFailure reads %s output", (_, line, changed, kind) => {
    expect(baseFailure({ code: 1, stdout: `${line}\n`, stderr: "" }, changed).kind).toBe(kind)
  })

  test("baseFailure treats a missing runner or a timeout as never run", () => {
    expect(baseFailure({ code: 127, stdout: "", stderr: "sh: vitest: command not found\n" }, []).kind).toBe("broken")
    expect(baseFailure({ code: null, stdout: "", stderr: "solodev: timed out after 10ms" }, []).kind).toBe("broken")
  })

  test("C4 warns when an assertion goes away and fails when the test is deleted", async () => {
    await gate()
    implement()
    write("test/hello.test.js", TEST.replace(/assert\.strictEqual\(hello\("ana"\).*\n/, ""))
    const weakened = await check("C4")
    expect(weakened.status).toBe("warn")
    expect(weakened.details[0]).toContain("1 assertion(s) removed")
    fs.rmSync(path.join(root, "test/hello.test.js"))
    expect((await check("C4")).status).toBe("fail")
  })

  test("C4 also compares other changed tests with the base", async () => {
    write("test/existing.test.js", 'import assert from "node:assert"\nassert.ok(1)\nassert.ok(2)\n')
    commit("test: existing", "test")
    sh("branch", "-f", "main", "HEAD")
    await gate()
    implement()
    write("test/existing.test.js", 'import assert from "node:assert"\nassert.ok(1)\n')
    const r = await check("C4")
    expect(r.status).toBe("warn")
    expect(r.details.join("\n")).toContain("test/existing.test.js: 1 assertion(s) removed")
    fs.rmSync(path.join(root, "test/existing.test.js"))
    expect((await check("C4")).summary).toContain("test/existing.test.js was deleted")
  })

  test("C5 fails without an approval and when code lands before it", async () => {
    expect((await check("C5")).summary).toContain("not approved")
    write("src/hello.js", IMPL)
    commit("feat: jumped the gate", "src")
    await gate()
    const r = await check("C5")
    expect(r.status).toBe("fail")
    expect(r.details.join("\n")).toContain("feat: jumped the gate")
  })

  test("C5 reopens the gate when the spec or plan changes after approval", async () => {
    await gate()
    expect((await check("C5")).status).toBe("pass")
    feat("plan.md", `${plan()}\nOne more line.\n`)
    expect((await check("C5")).summary).toContain("changed since approval")
    expect((await featureStatus(root, state, "hello", { pr: async () => null })).stage).toBe("gate")
    await approve({ root, dir })
    expect((await check("C5")).status).toBe("pass")
  })

  test("C6 fails a tracked change left in the project", async () => {
    await gate()
    implement()
    expect((await check("C6")).status).toBe("pass")
    write("src/hello.js", `${IMPL}// reviewer was here\n`)
    const r = await check("C6")
    expect(r.status).toBe("fail")
    expect(r.details).toEqual(["src/hello.js"])
  })

  test("C7 blocks on an open major and accepts it once fixed", async () => {
    const table = (status: string) =>
      `| id | severity | location | status | finding |\n|---|---|---|---|---|\n| R1 | major | src/hello.js:1 | ${status} | x |\n`
    feat("review.md", table("open"))
    expect((await check("C7")).status).toBe("fail")
    feat("review.md", table("fixed"))
    expect((await check("C7")).status).toBe("pass")
    feat("review.md", table("disputed"))
    expect((await check("C7")).summary).toContain("unknown severity or status")
  })

  test("C8 requires a passing verdict for each uncovered scenario", async () => {
    await gate(plan("S2"))
    expect((await check("C8")).summary).toContain("no qa.md for S2")
    feat("qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | fail | greets wrong |\n")
    expect((await check("C8")).status).toBe("fail")
    feat("qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | manual | needs a real inbox |\n")
    expect((await check("C8")).summary).toContain("S2 needs a person")
    feat("qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | waived | user: covered by staging |\n")
    expect((await check("C8")).status).toBe("pass")
    feat("qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | pass | ran it |\n")
    expect((await check("C8")).status).toBe("pass")
  })
  test("C9 fails an env var read since the base until a README or .env.example names it", async () => {
    await gate()
    implement()
    expect((await check("C9")).summary).toBe("no new env reads")
    write("src/pay.js", 'export const key = () => process.env.PAY_KEY ?? process.env["NODE_ENV"]\n')
    write("test/pay.test.js", "process.env.TEST_ONLY_VAR\n")
    const r = await check("C9")
    expect(r.status).toBe("fail")
    expect(r.details).toEqual([
      "PAY_KEY read in src/pay.js — add it to the owning README's ## Configuration or .env.example",
    ])
    write("src/README.md", "# Pay\n\n## Configuration\n\n| PAY_KEY | yes | charges | dashboard |\n")
    expect((await check("C9")).summary).toBe("1 env var(s) read, all documented")
    commit("feat: pay")
    write("src/hook.py", 'secret = os.environ.get("HOOK_SECRET")\n')
    expect((await check("C9")).details[0]).toContain("HOOK_SECRET read in src/hook.py")
    write(".env.example", "HOOK_SECRET=\n")
    expect((await check("C9")).status).toBe("pass")
  })
})

describe("status", () => {
  const pr = (info: PrInfo | null) => ({ pr: async () => info })
  const stage = async (info: PrInfo | null = null) => (await featureStatus(root, state, "hello", pr(info))).stage

  test("walks the stages from the feature folder and the PR", async () => {
    expect(await stage()).toBe("spec")
    feat("spec.md", SPEC)
    feat("plan.md", plan())
    expect(await stage()).toBe("gate")
    await approve({ root, dir, date: "2026-10-12" })
    const implementing = await featureStatus(root, state, "hello", pr(null))
    expect(implementing.stage).toBe("implement")
    expect(implementing.approved).toMatch(/^2026-10-12 at [0-9a-f]{7}$/)
    feat(
      "review.md",
      "| id | severity | location | status | finding |\n|-|-|-|-|-|\n| R1 | blocker | a:1 | open | x |\n",
    )
    const reviewing = await featureStatus(root, state, "hello", pr(null))
    expect(reviewing.stage).toBe("review")
    expect(reviewing.notes).toEqual(["open: R1"])
    feat(
      "review.md",
      "| id | severity | location | status | finding |\n|-|-|-|-|-|\n| R1 | blocker | a:1 | fixed | x |\n",
    )
    expect(await stage()).toBe("pr")
    const draft = { url: "https://example.com/pr/1", isDraft: true, state: "OPEN" }
    expect(await stage(draft)).toBe("qa")
    expect(await stage({ ...draft, isDraft: false })).toBe("done")
  })
})
