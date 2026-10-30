import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { greet } from "./greet.js"

const dev = (...args) => execFileSync(process.execPath, ["src/index.js", ...args], { encoding: "utf8" })

describe("greet", () => {
  it("@S1 returns the greeting for a name", () => {
    expect(greet("Ada")).toBe("Hello, Ada!")
  })

  it("@S2 npm run dev -- --name Ada prints it", () => {
    expect(dev("--name", "Ada")).toBe("Hello, Ada!\n")
  })

  it("@S3 npm run dev without --name greets the world", () => {
    expect(dev()).toBe("Hello, world!\n")
  })
})
