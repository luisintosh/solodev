import { describe, expect, test } from "vitest"
import { modelsFromCatalog } from "./models.ts"

const catalog = {
  hosts: { claude: { coder: "sonnet/high" }, codex: { coder: " sol/high " }, cursor: { coder: "session" } },
}

describe("modelsFromCatalog", () => {
  test("passes each tool's coder through as written", () => {
    expect(modelsFromCatalog(catalog)).toEqual({
      claude: { coder: "sonnet/high" },
      codex: { coder: "sol/high" },
      cursor: { coder: "session" },
    })
  })

  test("refuses a tool with no coder", () => {
    expect(() => modelsFromCatalog({ hosts: { ...catalog.hosts, cursor: {} } })).toThrow(/cursor/)
  })
})
