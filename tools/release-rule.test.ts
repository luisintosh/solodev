import { describe, expect, it } from "vitest"
import { skillsRuleViolations, treeDiff } from "./release-rule.ts"

describe("skillsRuleViolations", () => {
  it("accepts commits that leave skills/ alone", () => {
    expect(skillsRuleViolations([{ sha: "a".repeat(40), subject: "feat: x", files: ["src/a.ts"] }])).toEqual([])
  })

  it("accepts a release commit that touches only skills/", () => {
    const c = { sha: "b".repeat(40), subject: "release v8.1.0", files: ["skills/solo-task/SKILL.md"] }
    expect(skillsRuleViolations([c])).toEqual([])
  })

  it("rejects a non-release commit that touches skills/", () => {
    const c = { sha: "c".repeat(40), subject: "fix: tweak skill", files: ["skills/solo-task/SKILL.md", "src/a.ts"] }
    const release = { sha: "b".repeat(40), subject: "release v8.1.0", files: ["skills/solo-task/SKILL.md"] }
    expect(skillsRuleViolations([c, release])).toEqual([
      'ccccccc "fix: tweak skill" changes skills/ — only `pnpm run release` may write it',
    ])
  })

  it("rejects a release commit that touches more than skills/", () => {
    const c = { sha: "d".repeat(40), subject: "release v1.2.3", files: ["skills/x/SKILL.md", "README.md"] }
    expect(skillsRuleViolations([c])).toEqual([
      'ddddddd "release v1.2.3" also changes README.md — a release touches only skills/',
    ])
  })

  it("does not take a look-alike subject for a release", () => {
    const release = { sha: "f".repeat(40), subject: "release v8.1.0", files: ["skills/x/SKILL.md"] }
    const c = { sha: "e".repeat(40), subject: "release v8.1.0 and more", files: ["skills/x/SKILL.md"] }
    expect(skillsRuleViolations([c, release])).toHaveLength(1)
  })

  it("ignores commits older than the first release", () => {
    const release = { sha: "1".repeat(40), subject: "release v8.1.0", files: ["skills/x/SKILL.md"] }
    const old = { sha: "2".repeat(40), subject: "build harness toolkit", files: ["skills/old/SKILL.md"] }
    const late = { sha: "3".repeat(40), subject: "fix: hand edit", files: ["skills/x/SKILL.md"] }
    expect(skillsRuleViolations([release, old])).toEqual([])
    expect(skillsRuleViolations([late, release, old])).toHaveLength(1)
  })
})

describe("treeDiff", () => {
  it("lists changed, missing and extra paths", () => {
    const have = new Map([
      ["a", "1"],
      ["b", "2"],
      ["extra", "x"],
    ])
    const want = new Map([
      ["a", "1"],
      ["b", "changed"],
      ["missing", "m"],
    ])
    expect(treeDiff(have, want)).toEqual(["b", "extra", "missing"])
  })
})
