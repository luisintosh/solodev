---
name: arise-scout
description: "Maps the repo once before the first /arise run: writes a minimal AGENTS.md (the commands list solodev reads, plus constraints the code doesn't show) and docs/ARCHITECTURE.md. Run by the user as /arise-scout."
disable-model-invocation: true
---

Map this repository once, before the first `/arise` run, so agents start from facts instead of guesses.

Create what's missing; refresh an existing file only when the user asks. Confirm every command against the project's
manifests and scripts before writing it.

## AGENTS.md

Keep it short: agents follow everything in it, so each extra line costs every run. It holds:

- One line on what the project is.
- `## Commands`, a plain list in exactly this shape (solodev's CLI reads it):

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
  and a link to `docs/ARCHITECTURE.md`. Stay well under 100 lines; `solodev probe` warns past that.

## docs/ARCHITECTURE.md

A concise system overview: the module map, how data flows between modules, key decisions and dependencies, and how tests
are organized. Add one line for domain docs: a domain's `README.md` lives in the directory that owns it, and
`docs/domains/<domain>.md` covers one too cross-cutting for that. Don't write those domain docs now; the documenter
writes each one when a feature touches that domain.

Create `docs/feats/.gitkeep` so feature folders have a home.

## Writing docs

- **Current state only.** No changelog, dates, "updated because", "previously this used", or feature and PR references.
- **Every line earns its place.** Cut intros, "this section describes…", restatements and "note that". A named symbol,
  path, command or number beats an adjective; "fast", "robust" and "handled properly" say nothing.
- **One owner per fact.** `AGENTS.md` owns commands, `docs/ARCHITECTURE.md` the system map, `docs/feats/<slug>/` a
  feature's spec and plan. Link instead of copying; two copies drift apart.
- **Omit an empty section** instead of writing "N/A". The exception is Configuration: `None.` on one line, because that
  absence is what the reader came for.

Finish with a short summary: files created or skipped, the commands you confirmed, and anything you couldn't determine.
