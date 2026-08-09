import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { listFeatures } from "./status.ts"

describe("listFeatures", () => {
  let state: string

  beforeEach(() => {
    state = fs.mkdtempSync(path.join(os.tmpdir(), "solodev-status-"))
  })

  afterEach(() => {
    fs.rmSync(state, { recursive: true, force: true })
  })

  test("skips the strategist's roadmaps folder and plain files", async () => {
    fs.mkdirSync(path.join(state, "roadmaps", "onboarding"), { recursive: true })
    fs.mkdirSync(path.join(state, "csv-export"))
    fs.writeFileSync(path.join(state, "notes.txt"), "")
    expect(await listFeatures(state)).toEqual(["csv-export"])
  })

  test("a missing state folder has no features", async () => {
    expect(await listFeatures(path.join(state, "missing"))).toEqual([])
  })
})
