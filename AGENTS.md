# AGENTS.md

This file provides guidance to coding agents when working with code in this repository. `CLAUDE.md` is a symlink to this
file. Keep it under about 100 lines: link CONTRIBUTING.md or the README instead of repeating them.

## What this is

solodev ships no runtime app. It ships role skills, two shadow agents and a small workflow CLI that
`npx`/`bunx github:luisintosh/solodev` installs into a _consuming_ repo or `$HOME` (`.agents/skills/`,
`.claude/skills/`, `.claude/agents/`, `.cursor/agents/`, `.codex/agents/`, `.agents/bin/solodev.mjs`). Nothing here runs
against this repo's own code.

## Commands

- install: `pnpm install`
- dev: n/a
- build: `pnpm run build`
- test: `pnpm test`
- test_file: `pnpm exec vitest run {file}`
- lint: `pnpm run lint`
- typecheck: n/a (Node strips types; nothing runs tsc)

## Generation model

`src/catalog.yaml` (host × profile models, skills with line budgets, shadows with hard denies) and `src/prompts/**` are
the **only** sources of truth. `tools/transpile.ts` emits the skills for each host and the two shadows per host.

- Never hand-edit `dist/`, `manifest.txt`, `bin/install.js` or `release.json`: all are generated. Only `bin/install.js`
  and `release.json` are tracked. The installer downloads the rest of the payload from the GitHub Release that
  `release.json` names. Fix the catalog or the prompt body, then `pnpm run build`.
- Prompt bodies (`src/prompts/skills/<name>/SKILL.md`, `references/*.md`, `agents/*.md`) carry **no frontmatter**;
  transpile adds it.
- `{{include:fragments/<name>.md}}` in a prompt body is resolved at transpile time.

## How changes stay thin

solodev targets top-tier models on Claude Code, Codex and Cursor. Keep it that way:

- **Check before instruction.** A rule verifiable from git, files or an exit code goes in `src/cli/checks.ts` with a
  test, not in a prompt.
- **Load on demand.** A skill body holds the goal, the steps and the done-when; detail a step needs only sometimes goes
  in its `references/`. Raise a skill's `budget` only with a reason in the commit message.
- **Plain prompts.** "Do X when Y", no capitalized MUST/NEVER/CRITICAL/ALWAYS, no step-by-step for what a top model
  already knows.
- **Git for code, one folder per feature.** No state files and no stage machine. A feature's spec, plan, reports and
  approval line live in its folder outside the repo (`~/.agents/skills/solodev/<repo>/<slug>/`), the code in git, and
  `solodev status` derives the stage from both. Nothing harness-related is committed to the user's repo.
- **One writer.** Only `shadow-coder` edits source; reviewers and the verifier change only their report.
- **The user decides.** New pauses for the user go in `/arise`'s "ask the user only at" list; nothing approves the gate
  or merges for them.
- **No new stage or agent** unless an outcome eval shows it pays for itself. Two shadows, two profiles, three hosts.

## Checked artifacts

`pnpm run check` fails the build (and CI) on drift, so these must be updated together:

- Changing a model in `src/catalog.yaml` requires editing the matrix in `README.md` and `GOLDEN_MODELS` in
  `tools/models.ts` to match.
- Any `src/` change requires a `pnpm run build` before `pnpm run check`; check compares against `dist/` and against
  `manifest.txt` hashes.
- Adding, removing or renaming a skill or shadow: `src/catalog.yaml`, its folder under `src/prompts/`, the `SKILLS` /
  `SHADOWS` lists in `tools/check.ts`, the lists in `test/e2e-install.sh`, `README.md`, and its `evals/<skill>/`.
- Changing a prompt or a skill `description`: rerun that skill's evals; changing the workflow (stages, checks, the
  shadows) also needs `node tools/eval.ts run` against the baseline before release.
- A new or changed check: `src/cli/checks.ts`, its test in `src/cli/checks.test.ts`, `src/cli/help.ts`, and the checks
  table in `README.md`.

## Build, test, release

@CONTRIBUTING.md

## Code style

Biome lints and formats `src/**/*.ts`, `tools/**/*.ts`, and the JSON files (`pnpm run lint`, `pnpm run lint:fix`).
Prettier formats only Markdown and YAML (`**/*.{md,yaml,yml}`). `pnpm run format` runs both and `pnpm run format:check`
verifies both. Shell scripts are covered by `bash -n` and `shellcheck` only. Both are configured to match the
conventions already in the tree, so keep to them:

- No semicolons, double quotes, 2-space indent.
- `.ts` extension in relative imports (`import { run } from "./exec.ts"`).
- Node builtins namespaced: `import * as fs from "node:fs/promises"`.
- `tools/*.ts` use a `#!/usr/bin/env node` shebang (Node ≥22.18 runs `.ts` directly) and top-level `await main()`.

## Commits

Conventional Commits, lowercase, imperative, no scope: `fix: allow openai/ model prefix for codex agents, sync README`.
Types in use: `feat`, `fix`, `refactor`, `chore`, `docs`. Feature branches are `feat/<slug>`.
