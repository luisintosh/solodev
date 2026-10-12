import { readFileSync } from "node:fs"

export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--version")) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    console.log(pkg.version)
    return
  }
  console.log("fixture-repo: hello")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
