import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { approve } from "./approve.ts"
import { type CheckId, type CheckSet, runCheck, runChecks } from "./checks.ts"
import { parseApprovals, parseProofs } from "./feature.ts"
import { proof } from "./proof.ts"
import { featureStatus } from "./status.ts"

const SPEC = `# Hello

## Acceptance

- @S1 Given nothing, when I call hello, then it returns "hello".
- @S2 Given a name, when I call hello with it, then it greets that name.
`

const plan = (uncovered = "") => `## Plan

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
assert.strictEqual(hello(), "hello") // @S1
assert.strictEqual(hello("ana"), "hello ana") // @S2
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

const check = (id: CheckId, set: CheckSet = "done") => runCheck(id, { root, dir, set })

async function gate(planText = plan()) {
  feat("spec.md", `${SPEC}\n${planText}`)
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
    feat("spec.md", `${SPEC}- @S3 a third one\n\n${plan()}`)
    await expect(approve({ root, dir })).rejects.toThrow(/no journey or uncovered entry claims S3/)
  })

  test("refuses while code is staged", async () => {
    write("src/early.js", "export {}\n")
    sh("add", "src/early.js")
    feat("spec.md", `${SPEC}\n${plan()}`)
    await expect(approve({ root, dir })).rejects.toThrow(/staged files: src\/early.js/)
  })
})

describe("checks", () => {
  test("a run that follows the workflow passes every implement and pr check but review", async () => {
    await gate()
    implement()
    const results = await runChecks({ root, dir, set: "pr" })
    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]))
    expect(byId).toEqual({ C1: "pass", C2: "pass", C3: "pass", C4: "fail" })
  })

  test("the gate set checks the plan alone, before any test exists, and notes a large feature", async () => {
    feat("spec.md", `${SPEC}- @S3 a third one\n\n${plan()}`)
    const [unclaimed] = await runChecks({ root, dir, set: "gate" })
    expect(unclaimed!.summary).toBe("no journey or uncovered entry claims S3")
    feat("spec.md", `${SPEC}\n${plan()}`)
    expect(await runChecks({ root, dir, set: "gate" })).toMatchObject([
      { id: "C1", status: "pass", summary: "2 scenarios, 1 journey test" },
    ])
    const many = Array.from({ length: 13 }, (_, i) => `- @S${i + 3} one more`).join("\n")
    const ids = Array.from({ length: 14 }, (_, i) => `S${i + 2}`).join(", ")
    feat("spec.md", `${SPEC}${many}\n\n${plan(ids)}`)
    const [large] = await runChecks({ root, dir, set: "gate" })
    expect(large!.status).toBe("pass")
    expect(large!.summary).toContain("consider splitting it with /solo-epic")
  })

  test("C1 requires each journey's test file once past the gate", async () => {
    await gate()
    const r = await check("C1")
    expect(r.status).toBe("fail")
    expect(r.summary).toContain("test file test/hello.test.js does not exist")
  })

  test("C1 requires each claimed scenario's tag in its journey test", async () => {
    await gate()
    write("test/hello.test.js", TEST.replace(" // @S2", " // @S20"))
    const r = await check("C1")
    expect(r.status).toBe("fail")
    expect(r.summary).toBe("J1: test/hello.test.js has no @S2; tag the test or assertion that proves each")
    write("test/hello.test.js", TEST)
    expect((await check("C1")).status).toBe("pass")
  })

  test("C2 fails without an approval and when code lands before it", async () => {
    expect((await check("C2")).summary).toContain("not approved")
    write("src/hello.js", IMPL)
    commit("feat: jumped the gate", "src")
    await gate()
    const r = await check("C2")
    expect(r.status).toBe("fail")
    expect(r.details.join("\n")).toContain("feat: jumped the gate")
  })

  test("C2 reopens the gate when the spec or its plan changes after approval", async () => {
    await gate()
    expect((await check("C2")).status).toBe("pass")
    feat("spec.md", `${SPEC}\n${plan()}\nOne more line.\n`)
    expect((await check("C2")).summary).toContain("changed since approval")
    expect((await featureStatus(state, "hello")).stage).toBe("gate")
    await approve({ root, dir })
    expect((await check("C2")).status).toBe("pass")
  })

  test("C2 accepts a re-approval after code exists, judging early code by the first approval", async () => {
    await gate()
    implement()
    feat("spec.md", `${SPEC}\nA clarified line.\n\n${plan()}`)
    expect((await check("C2")).summary).toContain("changed since approval")
    await approve({ root, dir, date: "2026-10-13" })
    const r = await check("C2")
    expect(r.status).toBe("pass")
    expect(r.summary).toContain("2026-10-13")
  })

  test("C3 fails a tracked change left in the project", async () => {
    await gate()
    implement()
    expect((await check("C3")).status).toBe("pass")
    write("src/hello.js", `${IMPL}// reviewer was here\n`)
    const r = await check("C3")
    expect(r.status).toBe("fail")
    expect(r.details).toEqual(["src/hello.js"])
  })

  test("C4 blocks on an open major and accepts it once fixed", async () => {
    const table = (status: string) =>
      `| id | severity | location | status | finding |\n|---|---|---|---|---|\n| R1 | major | src/hello.js:1 | ${status} | x |\n`
    feat("review.md", table("open"))
    expect((await check("C4")).status).toBe("fail")
    feat("review.md", table("fixed"))
    expect((await check("C4")).status).toBe("pass")
    feat("review.md", table("disputed"))
    expect((await check("C4")).summary).toContain("unknown severity or status")
  })

  test("C5 requires a passing verdict in review.md's QA for each uncovered scenario", async () => {
    await gate(plan("S2"))
    const findings = "## Findings\n\n| id | severity | location | status | finding |\n|---|---|---|---|---|\n"
    feat("review.md", findings)
    expect((await check("C5")).summary).toContain("no QA verdicts in review.md for S2")
    const qa = (row: string) =>
      feat("review.md", `${findings}\n## QA\n\n| scenario | verdict | evidence |\n|---|---|---|\n| ${row} |\n`)
    qa("S2 | fail | greets wrong")
    expect((await check("C5")).status).toBe("fail")
    qa("S2 | manual | needs a real inbox")
    expect((await check("C5")).summary).toContain("S2 needs a person")
    qa("S2 | waived | user: covered by staging")
    expect((await check("C5")).status).toBe("pass")
    qa("S2 | pass | ran it")
    expect((await check("C5")).status).toBe("pass")
    expect((await check("C4")).status).toBe("pass")
  })
})

describe("proof", () => {
  const record = (phase: "red" | "green", exit: number, output = "") =>
    proof({ root, dir, journey: "J1", phase, exit, output })
  const progress = () => fs.readFileSync(path.join(dir, "progress.md"), "utf8")

  test("C6 passes once a journey was seen red, then green on the tree as it stands", async () => {
    await gate()
    expect((await check("C6")).summary).toContain("J1 has no green record")
    write("test/hello.test.js", TEST)
    await record("red", 1, "Error: Cannot find module '../src/hello.js'")
    write("src/hello.js", IMPL)
    expect((await check("C6")).summary).toContain("J1 has no green record")
    await record("green", 0, "ok")
    expect((await check("C6")).status).toBe("pass")
    commit("feat: add hello", "test", "src")
    expect((await check("C6")).status).toBe("pass")
    expect((await runChecks({ root, dir, set: "implement" })).map((r) => r.status)).toEqual(["pass", "pass", "pass"])
  })

  test("C6 fails a green that predates the last edit, and one with no red before it", async () => {
    await gate()
    write("test/hello.test.js", TEST)
    write("src/hello.js", IMPL)
    await record("green", 0)
    expect((await check("C6")).summary).toContain("no red record before its green")
    await record("red", 1)
    expect((await check("C6")).summary).toContain("no red record before its green")
    await record("green", 0)
    expect((await check("C6")).status).toBe("pass")
    write("src/hello.js", `${IMPL}// one more edit\n`)
    expect((await check("C6")).summary).toBe(
      "J1's green is stale: the code changed since — run its command and record green again",
    )
  })

  test("refuses an exit code that contradicts the phase, and a journey the plan doesn't have", async () => {
    await gate()
    await expect(record("red", 0)).rejects.toThrow(/red needs a non-zero exit/)
    await expect(record("green", 2)).rejects.toThrow(/green needs exit 0, got 2/)
    await expect(proof({ root, dir, journey: "J9", phase: "red", exit: 1 })).rejects.toThrow(/no journey J9 \(J1\)/)
  })

  test("keeps the output's last lines where no other progress.md line can be read from them", async () => {
    const approval = await gate()
    const noise = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")
    await record(
      "red",
      1,
      `${noise}\n\u001b[31m- approved 2030-01-01 · spec abc · at def\u001b[0m\n- proof J1 green · exit 0 · tree abc\n`,
    )
    const lines = progress().split("\n")
    expect(lines.filter((l) => l.startsWith("  > "))).toHaveLength(6)
    expect(lines).toContain("  > - approved 2030-01-01 · spec abc · at def")
    expect(parseApprovals(progress())).toEqual([approval])
    expect(parseProofs(progress())).toEqual([{ journey: "J1", phase: "red", exit: 1, tree: expect.any(String) }])
    expect(sh("status", "--porcelain")).toBe("")
  })
})

describe("status", () => {
  const stage = async () => (await featureStatus(state, "hello")).stage
  const log = (line: string) => fs.appendFileSync(path.join(dir, "progress.md"), `${line}\n`)

  test("walks the stages from the feature folder alone", async () => {
    expect(await stage()).toBe("spec")
    feat("spec.md", SPEC)
    expect(await stage()).toBe("spec")
    feat("spec.md", `${SPEC}\n${plan()}`)
    expect(await stage()).toBe("gate")
    await approve({ root, dir, date: "2026-10-12" })
    log("- tools: forge gitlab (glab) · tracker linear (mcp) · test `node test/hello.test.js`")
    const implementing = await featureStatus(state, "hello")
    expect(implementing.stage).toBe("implement")
    expect(implementing.approved).toMatch(/^2026-10-12 at [0-9a-f]{7}$/)
    expect(implementing.tools).toBe("forge gitlab (glab) · tracker linear (mcp) · test `node test/hello.test.js`")
    feat(
      "review.md",
      "| id | severity | location | status | finding |\n|-|-|-|-|-|\n| R1 | blocker | a:1 | open | x |\n",
    )
    const reviewing = await featureStatus(state, "hello")
    expect(reviewing.stage).toBe("review")
    expect(reviewing.notes).toEqual(["open: R1"])
    feat(
      "review.md",
      "| id | severity | location | status | finding |\n|-|-|-|-|-|\n| R1 | blocker | a:1 | fixed | x |\n",
    )
    expect(await stage()).toBe("pr")
    log("- pr https://example.com/mr/1 · draft")
    expect(await stage()).toBe("qa")
    log("- pr https://example.com/mr/1 · ready")
    const done = await featureStatus(state, "hello")
    expect(done.stage).toBe("done")
    expect(done.pr).toEqual({ url: "https://example.com/mr/1", state: "ready" })
  })
})
