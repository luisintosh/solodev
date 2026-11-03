#!/usr/bin/env node
/**
 * Build the portable Node ESM workflow CLI, with the shadows `solodev init` writes, into
 * dist/product/skills/solodev-mission/scripts/solodev-cli.mjs.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { build, type Plugin } from "esbuild"
import { parse as parseYaml } from "yaml"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// The CLI ships inside the commander's skill, so `npx skills add` installs it with the skills.
const outDir = path.join(root, "dist", "product", "skills", "solodev-mission", "scripts")
const BUNDLES = [{ entry: path.join(root, "src", "cli", "main.ts"), out: path.join(outDir, "solodev-cli.mjs") }]
const HOSTS = ["claude", "codex", "cursor"]

/** `import agents from "solodev:agents"`: the shadows transpile built, by host and file name, for `solodev init`. */
const agentsPlugin: Plugin = {
  name: "solodev-agents",
  setup(b) {
    b.onResolve({ filter: /^solodev:agents$/ }, (args) => ({ path: args.path, namespace: "solodev-agents" }))
    b.onLoad({ filter: /.*/, namespace: "solodev-agents" }, async () => {
      const agents: Record<string, Record<string, string>> = {}
      for (const host of HOSTS) {
        const dir = path.join(root, "dist", host, "agents")
        const files = (await fs.readdir(dir).catch(() => [] as string[])).sort()
        if (!files.length) throw new Error(`build-cli: ${dir} is empty — run node tools/transpile.ts first`)
        agents[host] = {}
        for (const file of files) agents[host][file] = await fs.readFile(path.join(dir, file), "utf8")
      }
      return { contents: JSON.stringify(agents), loader: "json" }
    })
  },
}

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
    plugins: [yamlPlugin, agentsPlugin],
    logLevel: "warning",
  })
  const js = await fs.readFile(outJs, "utf8")
  const body = js.replace(/^#!.*\n/, "")
  await fs.writeFile(outJs, `#!/usr/bin/env node\n${body}`, { mode: 0o755 })
  await fs.chmod(outJs, 0o755)
}
console.log("build-cli: wrote dist/product/skills/solodev-mission/scripts/solodev-cli.mjs")
