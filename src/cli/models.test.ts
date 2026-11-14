import { describe, expect, test } from "vitest"
import { modelsFromCatalog } from "./models.ts"

const catalog = {
  hosts: {
    claude: { profiles: { think: { id: "opus", effort: "medium" }, implement: { id: "sonnet", effort: "high" } } },
    codex: { profiles: { think: { id: "astra", effort: "medium" }, implement: { id: "sol", effort: "high" } } },
    cursor: { profiles: { think: { id: "argon", effort: "high" }, implement: { id: "grok", effort: "high" } } },
  },
  shadows: {
    "shadow-reviewer": { profile: "think" },
    "shadow-spec-reviewer": { profile: "think", effort: { claude: "high" } },
  },
}

describe("modelsFromCatalog", () => {
  test("a shadow runs on its profile's model, at its own effort where the catalog sets one for that tool", () => {
    const models = modelsFromCatalog(catalog)
    expect(models.claude.shadows).toEqual({
      "shadow-reviewer": { id: "opus", effort: "medium" },
      "shadow-spec-reviewer": { id: "opus", effort: "high" },
    })
    expect(models.cursor.shadows["shadow-spec-reviewer"]).toEqual({ id: "argon", effort: "high" })
  })

  test("refuses a shadow whose profile a tool lacks", () => {
    expect(() => modelsFromCatalog({ ...catalog, shadows: { "shadow-x": { profile: "check" } } })).toThrow(/shadow-x/)
  })
})
