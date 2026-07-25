import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

const run = (greeting) => {
  const env = { ...process.env }
  delete env.GREETING
  if (greeting !== undefined) env.GREETING = greeting
  return spawnSync(process.execPath, ["src/index.js"], { encoding: "utf8", env }).stdout.trim()
}

test("GREETING changes the line", () => {
  assert.equal(run("Hi"), "Hi, world!")
  assert.equal(run("  Hola "), "Hola, world!")
})

test("unset, empty or blank GREETING keeps the default", () => {
  assert.equal(run(), "fixture-repo: hello")
  assert.equal(run(""), "fixture-repo: hello")
  assert.equal(run("   "), "fixture-repo: hello")
})
