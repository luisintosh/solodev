export function line(env = process.env) {
  const greeting = (env.GREETING ?? "").trim()
  return greeting ? `${greeting}, world!` : "fixture-repo: hello"
}

export function main() {
  console.log(line())
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
