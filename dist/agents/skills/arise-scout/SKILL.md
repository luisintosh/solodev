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

- Constraints a reader couldn't discover from the code: a service that must be running, a generated file never edited by
  hand, a command that must not run in CI. Leave out anything a linter, the types or a quick read already says.
- A link to `docs/ARCHITECTURE.md`.

Stay well under 100 lines; `solodev probe` warns past that.

## docs/ARCHITECTURE.md

A concise system overview: the module map, how data flows between modules, key decisions and dependencies, and how tests
are organized. Add one line for domain docs: a domain's `README.md` lives in the directory that owns it, and
`docs/domains/<domain>.md` covers one too cross-cutting for that. Don't write those domain docs now; the documenter
writes each one when a feature touches that domain.

## docs/feats/

Create `docs/feats/.gitkeep` so feature folders have a home.

**Current state only.** Never narrate a document's own history — no changelog, no dates, no "updated because", no
"previously this used", no feature or PR reference. **Every line earns its place**: cut throat-clearing intros, "this
section describes…", restatements of what the reader just read, and "note that" preambles; a named symbol, path,
command, or number beats an adjective, and "fast", "robust", "handled properly" say nothing. **Never restate what
another document owns** — `AGENTS.md` owns commands and conventions, `docs/ARCHITECTURE.md` owns the system-wide map,
`docs/feats/<slug>/` owns per-feature spec and plan; link, never copy, because two copies drift apart. **Omit a section
with nothing to say** rather than writing "N/A" or "None yet" — a missing section is itself information. The one
exception is `Configuration`: when something genuinely needs none, `None.` on one line, because that absence is the
answer the reader came for.

Finish with a short summary: files created or skipped, the commands you confirmed, and anything you couldn't determine.
