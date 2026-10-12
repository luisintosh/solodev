export function greeting(argv) {
  const i = argv.indexOf("--name")
  if (i === -1) return { out: "fixture-repo: hello" }
  const name = argv[i + 1]
  if (!name) return { err: "error: --name needs a value" }
  return { out: `Hello, ${name}!` }
}

export function main(argv = process.argv.slice(2)) {
  const { out, err } = greeting(argv)
  if (err) {
    console.error(err)
    process.exitCode = 1
    return
  }
  console.log(out)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
