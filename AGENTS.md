# AGENTS.md

This file provides guidance to coding agents when working with code in this repository. `CLAUDE.md` is a symlink to this
file. Keep it under about 100 lines: link CONTRIBUTING.md or the README instead of repeating them.

## What this is

solodev ships no runtime app. It ships role skills, with a small workflow CLI inside the solo-task skill, that
`npx skills add luisintosh/solodev` installs into a _consuming_ repo or `$HOME`; `/solo-task init` (the CLI's `init`)
then writes the shadow agents per coding tool (`.claude/agents/`, `.cursor/agents/`, `.codex/agents/`). Nothing here
runs against this repo's own code.

One branch, `master`: branch from it and PR into it. `skills/` at the root is what `npx skills add` installs, and only
`pnpm run release` writes it: never edit, rebuild or copy into `skills/` by hand or in a feature PR. `pnpm run check`
fails on any other commit that touches it.

## Commands

- install: `pnpm install`
- build: `pnpm run build`
- test: `pnpm test`
- test_file: `pnpm exec vitest run {file}`
- lint: `pnpm run lint`
- typecheck: n/a (Node strips types; nothing runs tsc)

## Generation model

`src/catalog.yaml` (host × profile models, skills with line budgets, shadows with hard denies) and `src/prompts/**` are
the **only** sources of truth. `tools/transpile.ts` emits one skill tree for every host into `dist/product/skills` and
the shadows per host into `dist/<host>/agents`; `tools/build-cli.ts` bundles the CLI and copies those shadows beside it,
as plain files, into `dist/product/skills/solo-task/shadows/`.

- `dist/` is generated and untracked: fix the catalog or the prompt body, then `pnpm run build`.
- Prompt bodies (`src/prompts/skills/<name>/SKILL.md`, `references/*.md`, `agents/*.md`) carry **no frontmatter**;
  transpile adds it.
- `{{include:fragments/<name>.md}}` in a prompt body is resolved at transpile time.
- Names: skills are `solo-<name>` (plus `gen-docs`), shadows `shadow-<name>`. `solo-task`, `solo-epic` and `gen-docs`
  are the ones a user types.

## How changes stay thin

solodev targets top-tier models on Claude Code, Codex and Cursor. Keep it that way:

- **Check before instruction.** A rule verifiable from git or solodev's own files without knowing the project's language
  or tools goes in `src/cli/checks.ts` with a test. Anything that has to run or recognize the user's stack (their
  commands, test runners, forge, tracker) goes in a prompt; the reviewer judges it from the output.
- **Load on demand.** A skill body holds the goal, the steps and the done-when; detail a step needs only sometimes goes
  in its `references/`. Raise a skill's `budget` only with a reason in the commit message.
- **Plain prompts.** "Do X when Y", no capitalized MUST/NEVER/CRITICAL/ALWAYS, no step-by-step for what a top model
  already knows.
- **Git for code, one folder per feature.** No state files and no stage machine. A feature's spec, plan, reports and
  approval line live in its folder outside the repo (`~/.agents/solodev/<owner>/<repo>/<slug>/`), the code in git, and
  `solodev status` derives the stage from both. Nothing harness-related is committed to the user's repo.
- **Capability, not product.** A prompt names the tracker, forge or carrier generically, with one example at most. A
  skill ends on its own output and doesn't hand off to another skill.
- **One writer.** Only `shadow-coder` edits source. `shadow-reviewer` changes only `review.md`; the spec reviewer and
  the verifier reply and change no file. The commander owns the rest of the feature folder.
- **The user decides.** New pauses for the user go in `/solo-task`'s "ask the user only at" list; nothing approves the
  gate or merges for them.
- **No new stage or agent** unless the stage evals show it pays for itself. Four shadows, two profiles, three hosts. A
  shadow exists per model-and-effort a role needs, never per lens: reviewers started together share a prompt cache, so
  lenses share `shadow-reviewer`.

## Checked artifacts

`pnpm run check` fails the build (and CI) on drift, so these must be updated together:

- Changing a model in `src/catalog.yaml` requires editing the matrix in `README.md` and `GOLDEN_MODELS` in
  `tools/models.ts` to match.
- Any `src/` change requires a `pnpm run build` before `pnpm run check`; check compares against `dist/` and runs the
  built CLI's `init --dry-run`.
- Adding, removing or renaming a skill or shadow: `src/catalog.yaml`, its folder under `src/prompts/`, the `SKILLS` /
  `SHADOWS` lists in `tools/check.ts` (and `SHADOWS` in `src/cli/probe.ts`), the lists in `test/e2e-init.sh`, the old
  name in `LEGACY_SKILLS` in `tools/eval-lib.ts`, `locate` in `src/cli/init.ts`, `skillDir` in `tools/build-cli.ts`,
  `README.md`, and its scenarios and routing queries in `evals/quiz.json`.
- Changing a prompt or a skill `description`: `pnpm run eval:quiz`; changing the workflow (stages, checks, the shadows)
  also needs `pnpm run eval:stage`, and so does a release (`pnpm run release`, the only writer of `skills/`).
- Changing what a prompt decides: add or edit its scenario in `evals/quiz.json` in the same commit, one decision per
  question. An `unclear` note that repeats is a prompt gap: fix the prompt.
- Changing what a stage eval's setup relies on (the feature-folder format, `solodev approve`, the fixture):
  `pnpm run eval:validate`.
- A new or changed check: `src/cli/checks.ts`, its test in `src/cli/checks.test.ts`, and `src/cli/help.ts`.
- A new catalog field: emit it in `tools/transpile.ts` and fail on drift in `tools/check.ts` (as `argument_hint` does).
- Retiring a config key or CLI field: `probe` warns, not fails, with a test; update `src/cli/help.ts` and `README.md`.

## Build, test, release

@CONTRIBUTING.md

## Code style

Biome lints and formats `src/**/*.ts`, `tools/**/*.ts` and the JSON files; Prettier formats only Markdown and YAML
(`pnpm run format`, `pnpm run format:check`). Shell scripts get `bash -n` and `shellcheck` only. Keep the `.ts`
extension in relative imports and namespace Node builtins (`import * as fs from "node:fs/promises"`).

## Commits

Conventional Commits, lowercase, imperative, no scope: `fix: allow openai/ model prefix for codex agents, sync README`.
Types in use: `feat`, `fix`, `refactor`, `chore`, `docs`. Feature branches are `feat/<slug>`, cut from `master`.
