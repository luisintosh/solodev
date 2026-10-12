import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createServer } from "../src/server.js"

let server
let base

before(async () => {
  server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

test("GET /health is ok", async () => {
  const r = await fetch(`${base}/health`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get("content-type"), /application\/json/)
  assert.deepEqual(await r.json(), { status: "ok" })
})

test("unknown paths are 404", async () => {
  const r = await fetch(`${base}/nope`)
  assert.equal(r.status, 404)
  assert.deepEqual(await r.json(), { error: "not found" })
})

test("POST /health is 405", async () => {
  const r = await fetch(`${base}/health`, { method: "POST" })
  assert.equal(r.status, 405)
  assert.deepEqual(await r.json(), { error: "method not allowed" })
})
