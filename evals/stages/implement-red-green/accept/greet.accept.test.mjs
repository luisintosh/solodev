import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { greet } from "./src/greet.js"

const dev = (...args) => spawnSync(process.execPath, ["src/index.js", ...args], { encoding: "utf8" })

test("@S1 greet returns the greeting for a name", () => {
  assert.equal(greet("Ada"), "Hello, Ada!")
})

test("@S2 --name prints the greeting", () => {
  assert.equal(dev("--name", "Ada").stdout.trim(), "Hello, Ada!")
})

test("@S3 no --name greets the world", () => {
  assert.equal(dev().stdout.trim(), "Hello, world!")
})
