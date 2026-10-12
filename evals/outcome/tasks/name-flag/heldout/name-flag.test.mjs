import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

const run = (...args) => spawnSync(process.execPath, ["src/index.js", ...args], { encoding: "utf8" })

test("--name greets that name", () => {
  const r = run("--name", "Ada")
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), "Hello, Ada!")
})

test("no --name keeps the default line", () => {
  assert.equal(run().stdout.trim(), "fixture-repo: hello")
})

test("an empty --name is an error", () => {
  const r = run("--name", "")
  assert.equal(r.status, 1)
  assert.match(r.stderr, /error: --name needs a value/)
})
