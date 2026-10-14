import { greet } from "./greet.js"

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--name")
  console.log(greet(argv[i + 1]))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
