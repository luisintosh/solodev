export function main() {
  console.log("fixture-repo: Helo")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
