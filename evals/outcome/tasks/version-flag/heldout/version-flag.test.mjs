import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { test } from "node:test"

const run = (...args) => spawnSync(process.execPath, ["src/index.js", ...args], { encoding: "utf8" })

test("package.json is at 0.1.0 and --version prints it", () => {
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).version, "0.1.0")
  assert.equal(run("--version").stdout.trim(), "0.1.0")
})

test("--version reads package.json rather than a constant", () => {
  const original = readFileSync("package.json", "utf8")
  try {
    writeFileSync("package.json", JSON.stringify({ ...JSON.parse(original), version: "9.9.9" }))
    assert.equal(run("--version").stdout.trim(), "9.9.9")
  } finally {
    writeFileSync("package.json", original)
  }
})

test("no flag keeps the default line", () => {
  assert.equal(run().stdout.trim(), "fixture-repo: hello")
})
