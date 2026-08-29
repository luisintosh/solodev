Map this repository once, so any agent, a `/solodev-mission` run included, starts from facts instead of guesses.

Create what's missing; refresh an existing file only when the user asks. Confirm every command against the project's
manifests and scripts before writing it.

## AGENTS.md

Keep it short: agents follow everything in it, so each extra line costs every run. It holds:

- One line on what the project is.
- `## Commands`, a plain list in this shape, so agents find each command at a glance:

  ```markdown
  ## Commands

  - install: `pnpm install`
  - dev: `pnpm dev`
  - build: `pnpm build`
  - test: `pnpm test`
  - test_file: `pnpm vitest run {file}` (one test file)
  - lint: `pnpm lint`
  - typecheck: `pnpm tsc --noEmit`
  ```

  Every name appears. The command is the first backticked span, and a note may follow it. Write `n/a` when the repo has
  no such command. `dev` is how to start the app locally; the verifier depends on it.

- Constraints a reader couldn't discover from the code (a service that must run, a generated file never edited by hand),
  and a link to `docs/ARCHITECTURE.md`. Stay well under 100 lines.

## docs/ARCHITECTURE.md

A concise system overview: the module map, how data flows between modules, key decisions and dependencies, and how tests
are organized. Add one line for domain docs: a short `README.md` signpost in the directory that owns a domain, with the
detail in doc comments. Don't write them now; the coder does when a feature touches that domain.

{{include:fragments/doc-style.md}}

You write only `AGENTS.md` and `docs/ARCHITECTURE.md`, and commit nothing. Finish with a short summary: files created or
skipped, the commands you confirmed, and anything you couldn't determine.
