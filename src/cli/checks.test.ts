import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { approve } from "./approve.ts"
import { type CheckId, type CheckSet, runCheck, runChecks } from "./checks.ts"
import { parseApprovals } from "./feature.ts"
import { featureStatus } from "./status.ts"

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
    const results = await runChecks({ root, dir, set: "pr" })
    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]))
    expect(byId).toEqual({ C1: "pass", C2: "pass", C3: "pass", C4: "fail" })
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

  test("C2 reopens the gate when the spec or plan changes after approval", async () => {
    await gate()
    expect((await check("C2")).status).toBe("pass")
    feat("plan.md", `${plan()}\nOne more line.\n`)
    expect((await check("C2")).summary).toContain("changed since approval")
    expect((await featureStatus(state, "hello")).stage).toBe("gate")
    await approve({ root, dir })
    expect((await check("C2")).status).toBe("pass")
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

  test("C5 requires a passing verdict for each uncovered scenario", async () => {
    await gate(plan("S2"))
    expect((await check("C5")).summary).toContain("no qa.md for S2")
    feat("qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | fail | greets wrong |\n")
    expect((await check("C5")).status).toBe("fail")
    feat("qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | manual | needs a real inbox |\n")
    expect((await check("C5")).summary).toContain("S2 needs a person")
    feat("qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | waived | user: covered by staging |\n")
    expect((await check("C5")).status).toBe("pass")
    feat("qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | pass | ran it |\n")
    expect((await check("C5")).status).toBe("pass")
  })
})

describe("status", () => {
  const stage = async () => (await featureStatus(state, "hello")).stage
  const log = (line: string) => fs.appendFileSync(path.join(dir, "progress.md"), `${line}\n`)

  test("walks the stages from the feature folder alone", async () => {
    expect(await stage()).toBe("spec")
    feat("spec.md", SPEC)
    feat("plan.md", plan())
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
