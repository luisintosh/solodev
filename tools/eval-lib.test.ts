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

  it("moves only solodev-* skills aside and puts them back", async () => {
    await skill(skills(), "solodev-plan")
    await skill(skills(), "solodev-roadmap")
    await skill(skills(), "other")
    const restore = moveUserSkillsAside(home)
    expect(await ls(skills())).toEqual(["other"])
    expect((await ls(path.join(asideRoot(), String(process.pid)))).sort()).toEqual(["solodev-plan", "solodev-roadmap"])
    restore()
    expect((await ls(skills())).sort()).toEqual(["other", "solodev-plan", "solodev-roadmap"])
    expect(await fs.readFile(path.join(skills(), "solodev-plan", "SKILL.md"), "utf8")).toBe("solodev-plan")
    expect(await ls(asideRoot())).toEqual([])
    restore()
    expect((await ls(skills())).length).toBe(3)
  })

  it("does nothing without user-level solodev skills", async () => {
    await skill(skills(), "other")
    moveUserSkillsAside(home)()
    expect(await ls(skills())).toEqual(["other"])
    expect(await ls(asideRoot())).toEqual([])
  })

  it("restores skills a killed run left aside before moving them again", async () => {
    await skill(path.join(asideRoot(), "999999"), "solodev-plan")
    const restore = moveUserSkillsAside(home)
    expect(await ls(path.join(asideRoot(), String(process.pid)))).toEqual(["solodev-plan"])
    restore()
    expect(await ls(skills())).toEqual(["solodev-plan"])
    expect(await ls(asideRoot())).toEqual([])
  })

  it("refuses when a skill left aside would overwrite an installed one", async () => {
    await skill(path.join(asideRoot(), "999999"), "solodev-plan")
    await skill(skills(), "solodev-plan")
    expect(() => moveUserSkillsAside(home)).toThrow(/merge them by hand/)
  })

  it("refuses while another live run holds the skills aside", async () => {
    await skill(path.join(asideRoot(), String(process.ppid)), "solodev-plan")
    expect(() => moveUserSkillsAside(home)).toThrow(/another eval run/)
  })
})
