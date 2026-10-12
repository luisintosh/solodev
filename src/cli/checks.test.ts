import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { approve } from "./approve.ts"
import { type CheckId, type CheckSet, runCheck, runChecks } from "./checks.ts"
import { gateCommits } from "./git.ts"
import type { Models } from "./models.ts"
import { featureStatus, type PrInfo } from "./status.ts"

const models: Models = {
  claude: {
    think: { id: "claude-opus-5-5", effort: "medium" },
    implement: { id: "claude-sonnet-5-5", effort: "high" },
  },
  codex: { think: { id: "gpt-6.1-sol", effort: "max" }, implement: { id: "gpt-6.1-sol", effort: "medium" } },
  cursor: { think: { id: "grok-4.7", effort: "xhigh" }, implement: { id: "grok-4.7", effort: "medium" } },
}

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

function sh(...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
}

function write(rel: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), content)
}

function commit(message: string, ...paths: string[]) {
  sh("add", "--", ...(paths.length ? paths : ["."]))
  sh("commit", "-q", "-m", message)
}

const check = (id: CheckId, set: CheckSet = "done") => runCheck(id, { root, slug: "hello", set, timeoutMs: 30_000 })

async function gate(planText = plan()) {
  write("docs/feats/hello/spec.md", SPEC)
  write("docs/feats/hello/plan.md", planText)
  return approve({ root, slug: "hello", writer: "codex", via: "orca", models })
}

function implement() {
  write("test/hello.test.js", TEST)
  write("src/hello.js", IMPL)
  commit("feat: add hello", "test", "src")
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "solodev-test-"))
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
})

describe("approve", () => {
  test("commits the spec and plan with the gate and writer trailers", async () => {
    const approval = await gate()
    expect(approval.message).toContain("Solodev-Gate: approved")
    expect(approval.message).toContain("Solodev-Writer: codex/gpt-6.1-sol/medium via orca")
    expect(await gateCommits(root, "hello")).toEqual([
      { sha: approval.sha, writer: "codex/gpt-6.1-sol/medium via orca" },
    ])
    expect(sh("show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual([
      "docs/feats/hello/plan.md",
      "docs/feats/hello/spec.md",
    ])
  })

  test("refuses a plan that leaves a scenario unclaimed", async () => {
    write("docs/feats/hello/spec.md", `${SPEC}- @S3 a third one\n`)
    write("docs/feats/hello/plan.md", plan())
    await expect(approve({ root, slug: "hello", writer: "claude", via: "native", models })).rejects.toThrow(
      /no journey or uncovered entry claims S3/,
    )
  })

  test("refuses when code outside the feature folder is staged", async () => {
    write("src/early.js", "export {}\n")
    sh("add", "src/early.js")
    write("docs/feats/hello/spec.md", SPEC)
    write("docs/feats/hello/plan.md", plan())
    await expect(approve({ root, slug: "hello", writer: "claude", via: "native", models })).rejects.toThrow(
      /staged files outside docs\/feats\/hello\/: src\/early.js/,
    )
  })
})

describe("checks", () => {
  test("a run that follows the workflow passes every implement and pr check but review", async () => {
    await gate()
    implement()
    const results = await runChecks({ root, slug: "hello", set: "pr", timeoutMs: 30_000 })
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

  test("C1 names a missing command and shows a failing one's output", async () => {
    write("AGENTS.md", AGENTS.replace("- lint: n/a\n", "").replace("process.exit(0)", "process.exit(3)"))
    const r = await check("C1", "pr")
    expect(r.status).toBe("fail")
    expect(r.summary).toContain("lint missing")
    expect(r.summary).toContain("build FAIL")
  })

  test("C2 requires each journey's test file once past the gate", async () => {
    await gate()
    const r = await check("C2")
    expect(r.status).toBe("fail")
    expect(r.summary).toContain("test file test/hello.test.js does not exist")
  })

  test("C3 fails a test that already passes at the gate commit", async () => {
    write("src/hello.js", IMPL)
    commit("chore: hello existed before", "src")
    await gate()
    write("test/hello.test.js", TEST)
    commit("test: hello", "test")
    const r = await check("C3")
    expect(r.status).toBe("fail")
    expect(r.summary).toContain("J1 passes at gate")
  })

  test("C3 proves red then green and shows the gate failure", async () => {
    await gate()
    implement()
    const r = await check("C3")
    expect(r.status).toBe("pass")
    expect(r.summary).toBe("J1 red→green")
    expect(r.evidence?.join("\n")).toMatch(/Cannot find module|ERR_MODULE_NOT_FOUND/)
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

  test("C4 also compares other changed tests with the gate commit", async () => {
    write("test/existing.test.js", 'import assert from "node:assert"\nassert.ok(1)\nassert.ok(2)\n')
    commit("test: existing", "test")
    await gate()
    implement()
    write("test/existing.test.js", 'import assert from "node:assert"\nassert.ok(1)\n')
    const r = await check("C4")
    expect(r.status).toBe("warn")
    expect(r.details.join("\n")).toContain("test/existing.test.js: 1 assertion(s) removed")
    fs.rmSync(path.join(root, "test/existing.test.js"))
    expect((await check("C4")).summary).toContain("test/existing.test.js was deleted")
  })

  test("C5 fails when code lands before the gate", async () => {
    write("src/hello.js", IMPL)
    commit("feat: jumped the gate", "src")
    await gate()
    const r = await check("C5")
    expect(r.status).toBe("fail")
    expect(r.details.join("\n")).toContain("src/hello.js")
  })

  test("C6 fails a report commit that also changes code", async () => {
    await gate()
    implement()
    write("docs/feats/hello/review.md", "| id | severity | location | status | finding |\n|-|-|-|-|-|\n")
    write("src/hello.js", `${IMPL}// reviewer was here\n`)
    commit("docs: review")
    const r = await check("C6")
    expect(r.status).toBe("fail")
    expect(r.details[0]).toContain("src/hello.js beside its report")
  })

  test("C7 blocks on an open major and accepts it once fixed", async () => {
    const table = (status: string) =>
      `| id | severity | location | status | finding |\n|---|---|---|---|---|\n| R1 | major | src/hello.js:1 | ${status} | x |\n`
    write("docs/feats/hello/review.md", table("open"))
    expect((await check("C7")).status).toBe("fail")
    write("docs/feats/hello/review.md", table("fixed"))
    expect((await check("C7")).status).toBe("pass")
    write("docs/feats/hello/review.md", table("disputed"))
    expect((await check("C7")).summary).toContain("unknown severity or status")
  })

  test("C8 requires a passing verdict for each uncovered scenario", async () => {
    await gate(plan("S2"))
    expect((await check("C8")).summary).toContain("no qa.md for S2")
    write("docs/feats/hello/qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | fail | greets wrong |\n")
    expect((await check("C8")).status).toBe("fail")
    write(
      "docs/feats/hello/qa.md",
      "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | manual | needs a real inbox |\n",
    )
    expect((await check("C8")).summary).toContain("S2 needs a person")
    write(
      "docs/feats/hello/qa.md",
      "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | waived | user: covered by staging |\n",
    )
    expect((await check("C8")).status).toBe("pass")
    write("docs/feats/hello/qa.md", "| scenario | verdict | evidence |\n|---|---|---|\n| S2 | pass | ran it |\n")
    expect((await check("C8")).status).toBe("pass")
  })
  test("C9 fails an env var read since the gate until a README or .env.example names it", async () => {
    expect((await check("C9")).status).toBe("skip")
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
    write("docs/feats/hello/plan.md", `${plan()}\nNeeds PAY_KEY.\n`)
    expect((await check("C9")).status).toBe("fail")
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

  test("walks the stages from files, the gate commit and the PR", async () => {
    expect((await featureStatus(root, "hello", pr(null))).stage).toBe("spec")
    write("docs/feats/hello/spec.md", SPEC)
    write("docs/feats/hello/plan.md", plan())
    expect((await featureStatus(root, "hello", pr(null))).stage).toBe("gate")
    await approve({ root, slug: "hello", writer: "claude", via: "native", models })
    const implementing = await featureStatus(root, "hello", pr(null))
    expect(implementing.stage).toBe("implement")
    expect(implementing.writer).toBe("claude/claude-sonnet-5-5/high via native")
    write(
      "docs/feats/hello/review.md",
      "| id | severity | location | status | finding |\n|-|-|-|-|-|\n| R1 | blocker | a:1 | open | x |\n",
    )
    const reviewing = await featureStatus(root, "hello", pr(null))
    expect(reviewing.stage).toBe("review")
    expect(reviewing.notes).toEqual(["open: R1"])
    write(
      "docs/feats/hello/review.md",
      "| id | severity | location | status | finding |\n|-|-|-|-|-|\n| R1 | blocker | a:1 | fixed | x |\n",
    )
    expect((await featureStatus(root, "hello", pr(null))).stage).toBe("pr")
    const draft = { url: "https://example.com/pr/1", isDraft: true, state: "OPEN" }
    expect((await featureStatus(root, "hello", pr(draft))).stage).toBe("qa")
    expect((await featureStatus(root, "hello", pr({ ...draft, isDraft: false }))).stage).toBe("done")
  })

  test("a v1 state.yaml without a gate commit is reported as v1", async () => {
    write("docs/feats/hello/state.yaml", "stage: design\n")
    expect((await featureStatus(root, "hello", pr(null))).stage).toBe("v1")
  })
})
