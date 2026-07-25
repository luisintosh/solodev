import assert from "node:assert/strict"
import { test } from "node:test"
import { average, sum } from "../src/stats.js"

test("an empty list averages to 0", () => {
  assert.equal(average([]), 0)
})

test("normal lists are unchanged", () => {
  assert.equal(average([1, 2, 3, 4]), 2.5)
  assert.equal(average([-2, 2]), 0)
  assert.equal(sum([1, 2, 3]), 6)
})

test("a bad value throws a TypeError naming it", () => {
  assert.throws(() => average([1, "x", 3]), (err) => err instanceof TypeError && /x/.test(err.message))
  assert.throws(() => average([1, Number.NaN]), TypeError)
  assert.throws(() => average([Number.POSITIVE_INFINITY]), TypeError)
})
