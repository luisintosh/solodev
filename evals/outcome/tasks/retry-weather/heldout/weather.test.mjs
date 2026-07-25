import assert from "node:assert/strict"
import { test } from "node:test"
import { getOrder } from "../src/orders.js"
import { getUser } from "../src/users.js"
import { fetchWeather } from "../src/weather.js"

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const down = { ok: false, status: 503, json: async () => ({}) }

/** A fetch that answers from `script` in order and records each URL. */
function scripted(...script) {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    const next = script.shift()
    if (next instanceof Error) throw next
    return next
  }
  return { fn, calls }
}

test("fetchWeather returns the body and encodes the city", async () => {
  const f = scripted(ok({ temp: 21 }))
  assert.deepEqual(await fetchWeather("São Paulo", f.fn), { temp: 21 })
  assert.equal(f.calls[0], "https://example.com/weather?city=S%C3%A3o%20Paulo")
})

test("fetchWeather retries thrown errors and non-2xx answers", async () => {
  const f = scripted(new Error("reset"), down, ok({ temp: 5 }))
  assert.deepEqual(await fetchWeather("Oslo", f.fn), { temp: 5 })
  assert.equal(f.calls.length, 3)
})

test("fetchWeather gives up after three attempts and names the city", async () => {
  const f = scripted(down, down, down, ok({}))
  await assert.rejects(fetchWeather("Lima", f.fn), /Lima/)
  assert.equal(f.calls.length, 3)
})

test("getUser and getOrder behave as before", async () => {
  const u = scripted(down, ok({ id: 1 }))
  assert.deepEqual(await getUser(1, u.fn), { id: 1 })
  const o = scripted(down, down, down)
  await assert.rejects(getOrder(7, o.fn), /getOrder 7 failed: status 503/)
  assert.equal(o.calls.length, 3)
})
