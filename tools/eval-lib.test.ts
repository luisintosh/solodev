import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { moveUserSkillsAside } from "./eval-lib.ts"

describe("moveUserSkillsAside", () => {
  let home: string
  const skills = () => path.join(home, ".claude", "skills")
  const asideRoot = () => path.join(home, ".claude", "solodev-eval-aside")
  const ls = (dir: string) => fs.readdir(dir).catch(() => [] as string[])
  const skill = (dir: string, name: string) =>
    fs.mkdir(path.join(dir, name), { recursive: true }).then(() => fs.writeFile(path.join(dir, name, "SKILL.md"), name))

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "solodev-aside-"))
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true })
  })

  it("moves only solodev's skills aside and puts them back", async () => {
    await skill(skills(), "solo-plan")
    await skill(skills(), "solo-task")
    await skill(skills(), "solo-epic")
    await skill(skills(), "solodev-mission")
    await skill(skills(), "solo-leveling")
    await skill(skills(), "other")
    const restore = moveUserSkillsAside(home)
    expect((await ls(skills())).sort()).toEqual(["other", "solo-leveling"])
    expect((await ls(path.join(asideRoot(), String(process.pid)))).sort()).toEqual([
      "solo-epic",
      "solo-plan",
      "solo-task",
      "solodev-mission",
    ])
    restore()
    expect((await ls(skills())).sort()).toEqual([
      "other",
      "solo-epic",
      "solo-leveling",
      "solo-plan",
      "solo-task",
      "solodev-mission",
    ])
    expect(await fs.readFile(path.join(skills(), "solo-plan", "SKILL.md"), "utf8")).toBe("solo-plan")
    expect(await ls(asideRoot())).toEqual([])
    restore()
    expect((await ls(skills())).length).toBe(6)
  })

  it("moves user-level shadows aside and puts them back", async () => {
    const agents = path.join(home, ".claude", "agents")
    await fs.mkdir(agents, { recursive: true })
    await fs.writeFile(path.join(agents, "shadow-reviewer.md"), "old")
    await fs.writeFile(path.join(agents, "mine.md"), "mine")
    const restore = moveUserSkillsAside(home)
    expect(await ls(agents)).toEqual(["mine.md"])
    expect(await ls(path.join(asideRoot(), String(process.pid), "agents"))).toEqual(["shadow-reviewer.md"])
    restore()
    expect((await ls(agents)).sort()).toEqual(["mine.md", "shadow-reviewer.md"])
    expect(await ls(skills())).toEqual([])
    expect(await ls(asideRoot())).toEqual([])
  })

  it("does nothing without user-level solodev skills", async () => {
    await skill(skills(), "other")
    moveUserSkillsAside(home)()
    expect(await ls(skills())).toEqual(["other"])
    expect(await ls(asideRoot())).toEqual([])
  })

  it("restores skills a killed run left aside before moving them again", async () => {
    await skill(path.join(asideRoot(), "999999"), "solo-plan")
    const restore = moveUserSkillsAside(home)
    expect(await ls(path.join(asideRoot(), String(process.pid)))).toEqual(["solo-plan"])
    restore()
    expect(await ls(skills())).toEqual(["solo-plan"])
    expect(await ls(asideRoot())).toEqual([])
  })

  it("refuses when a skill left aside would overwrite an installed one", async () => {
    await skill(path.join(asideRoot(), "999999"), "solo-plan")
    await skill(skills(), "solo-plan")
    expect(() => moveUserSkillsAside(home)).toThrow(/merge them by hand/)
  })

  it("refuses while another live run holds the skills aside", async () => {
    await skill(path.join(asideRoot(), String(process.ppid)), "solo-plan")
    expect(() => moveUserSkillsAside(home)).toThrow(/another eval run/)
  })
})
