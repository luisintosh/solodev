# greet

`npm run dev` prints a fixed line. Users want it to greet them by name, and code elsewhere wants the greeting as a
function.

## Requirements

- A `greet(name)` function, exported from a new module, returns `Hello, <name>!`.
- `npm run dev -- --name <name>` prints `greet(<name>)`.
- `npm run dev` without `--name` prints `Hello, world!`.

Out of scope: other languages, other flags.

## Assumptions

1. The module is `src/greet.js`. If wrong, only the import path changes.

## Acceptance

- @S1 Given the name "Ada", when `greet("Ada")` is called, then it returns `Hello, Ada!`.
- @S2 Given the CLI, when `npm run dev -- --name Ada` runs, then it prints `Hello, Ada!`.
- @S3 Given the CLI, when `npm run dev` runs without `--name`, then it prints `Hello, world!`.
