import { afterEach, describe, expect, it } from "vitest"
import { createStore } from "./users.js"

const store = () => createStore([{ id: 1, name: "Ada" }])

describe("remove", () => {
  afterEach(() => {
    delete process.env.ADMIN_TOKEN
  })

  it("@S1 an admin removes a user", () => {
    process.env.ADMIN_TOKEN = "s3cret"
    const s = store()
    expect(s.remove(1, "s3cret")).toBe(true)
    expect(s.list()).toEqual([])
  })

  it("@S2 a wrong token removes nothing", () => {
    process.env.ADMIN_TOKEN = "s3cret"
    expect(store().remove(1, "nope")).toBe(false)
  })

  it("@S3 no admin token set removes nothing", () => {
    process.env.ADMIN_TOKEN = "x"
    expect(store().remove(1)).toBe(false)
  })
})
