#!/usr/bin/env node
/**
 * Build the portable Node ESM workflow CLI into dist/bin/solodev.mjs.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { build, type Plugin } from "esbuild"
import { parse as parseYaml } from "yaml"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(root, "dist", "bin")
const BUNDLES = [{ entry: path.join(root, "src", "cli", "main.ts"), out: path.join(outDir, "solodev.mjs") }]

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
    banner: { js: 'import { createRequire } from "node:module";const require=createRequire(import.meta.url);' },
    minify: true,
    plugins: [yamlPlugin],
    logLevel: "warning",
  })
  const js = await fs.readFile(outJs, "utf8")
  const body = js.replace(/^#!.*\n/, "")
  await fs.writeFile(outJs, `#!/usr/bin/env node\n${body}`, { mode: 0o755 })
  await fs.chmod(outJs, 0o755)
}
for (const stale of ["quest-state.mjs", "quest-state", "quest-state.js"])
  await fs.rm(path.join(outDir, stale), { force: true })

console.log("build-cli: wrote portable dist/bin/solodev.mjs")
