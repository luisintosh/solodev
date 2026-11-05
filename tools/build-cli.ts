#!/usr/bin/env node
/**
 * Build the portable Node ESM workflow CLI into dist/product/skills/mission/scripts/solodev-cli.mjs, and copy
 * the shadows `solodev init` writes, as plain files, to dist/product/skills/mission/shadows/<host>/.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { build, type Plugin } from "esbuild"
import { parse as parseYaml } from "yaml"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// The CLI ships inside the commander's skill, so `npx skills add` installs it with the skills.
const skillDir = path.join(root, "dist", "product", "skills", "mission")
const outDir = path.join(skillDir, "scripts")
const BUNDLES = [{ entry: path.join(root, "src", "cli", "main.ts"), out: path.join(outDir, "solodev-cli.mjs") }]
const HOSTS = ["claude", "codex", "cursor"]

/** Inline `import x from "*.yaml"` as parsed JSON. */
const yamlPlugin: Plugin = {
  name: "yaml",
  setup(b) {
    b.onLoad({ filter: /\.ya?ml$/ }, async (args) => ({
      contents: JSON.stringify(parseYaml(await fs.readFile(args.path, "utf8"))),
      loader: "json",
    }))
  },
}

await fs.mkdir(outDir, { recursive: true })
await copyShadows()

for (const { entry, out } of BUNDLES) await bundle(entry, out)

async function bundle(entry: string, outJs: string) {
  await build({
    entryPoints: [entry],
    outfile: outJs,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // Bundled CJS deps (yaml) call require() for node builtins; ESM output needs a real require.
    // Readable on purpose: users and skill registries audit this file, so it ships unminified.
    banner: {
      js: [
        "// solodev CLI, bundled from src/cli/ at https://github.com/luisintosh/solodev/tree/develop/src/cli",
        'import { createRequire } from "node:module";const require=createRequire(import.meta.url);',
      ].join("\n"),
    },
    minify: false,
    plugins: [yamlPlugin],
    logLevel: "warning",
  })
  const js = await fs.readFile(outJs, "utf8")
  const body = js.replace(/^#!.*\n/, "")
  await fs.writeFile(outJs, `#!/usr/bin/env node\n${body}`, { mode: 0o755 })
  await fs.chmod(outJs, 0o755)
}

/** The shadows ship beside the CLI as readable files, so what `solodev init` installs can be audited before it runs. */
async function copyShadows() {
  const shadowsDir = path.join(skillDir, "shadows")
  await fs.rm(shadowsDir, { recursive: true, force: true })
  for (const host of HOSTS) {
    const dir = path.join(root, "dist", host, "agents")
    const files = (await fs.readdir(dir).catch(() => [] as string[])).sort()
    if (!files.length) throw new Error(`build-cli: ${dir} is empty — run node tools/transpile.ts first`)
    await fs.mkdir(path.join(shadowsDir, host), { recursive: true })
    for (const file of files) await fs.copyFile(path.join(dir, file), path.join(shadowsDir, host, file))
  }
}
console.log("build-cli: wrote dist/product/skills/mission/scripts/solodev-cli.mjs and shadows/")
