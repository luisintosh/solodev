# AGENTS.md

This file provides guidance to coding agents when working with code in this repository. `CLAUDE.md` is a symlink to this
file.

## What this is

solodev ships no runtime app. It ships role skills, two shadow agents and a small workflow CLI that
`npx`/`bunx github:luisintosh/solodev` installs into a _consuming_ repo or `$HOME` (`.agents/skills/`,
`.claude/skills/`, `.claude/agents/`, `.cursor/agents/`, `.codex/agents/`, `.agents/bin/solodev.mjs`). Nothing here runs
against this repo's own code.

## Generation model

`src/catalog.yaml` (host × profile models, skills with line budgets, shadows with hard denies) and `src/prompts/**` are
the **only** sources of truth. `tools/transpile.ts` emits the skills for each host and the two shadows per host.

- Never hand-edit `dist/` or `manifest.txt` — both are generated and **tracked**. Fix the catalog or the prompt body,
  then `pnpm run build` before commit.
- Prompt bodies (`src/prompts/skills/<name>/SKILL.md`, `references/*.md`, `agents/*.md`) carry **no frontmatter**;
  transpile adds it.
- `{{include:fragments/<name>.md}}` in a prompt body is resolved at transpile time.
- Prompts are short and plain: no capitalized MUST/NEVER/CRITICAL/ALWAYS, and each skill stays within its `budget`.
  Detail a step needs only sometimes goes in the skill's `references/`, linked from `SKILL.md`.
- A rule that can be verified from git, files or an exit code belongs in `src/cli/checks.ts`, not in a prompt.

## Checked artifacts

`pnpm run check` fails the build (and CI) on drift, so these must be updated together:

- Changing a model in `src/catalog.yaml` requires editing the matrix in `README.md` and `GOLDEN_MODELS` in
  `tools/models.ts` to match.
- Any `src/` change requires a `pnpm run build` before `pnpm run check`; check compares against `dist/` and against
  `manifest.txt` hashes.

## Build, test, release

@CONTRIBUTING.md

## Code style

Biome lints and formats `src/**/*.ts`, `tools/**/*.ts`, and the JSON files (`pnpm run lint`, `pnpm run lint:fix`).
Prettier formats only Markdown and YAML (`**/*.{md,yaml,yml}`). `pnpm run format` runs both and `pnpm run format:check`
verifies both. Shell scripts are covered by `bash -n` and `shellcheck` only. Both are configured to match the
conventions already in the tree, so keep to them:

- No semicolons, double quotes, 2-space indent.
- `.ts` extension in relative imports (`import { deepMerge } from "./merge.ts"`).
- Node builtins namespaced: `import * as fs from "node:fs/promises"`.
- `tools/*.ts` use a `#!/usr/bin/env node` shebang (Node ≥22.18 runs `.ts` directly) and top-level `await main()`.

## Commits

Conventional Commits, lowercase, imperative, no scope: `fix: allow openai/ model prefix for codex agents, sync README`.
Types in use: `feat`, `fix`, `refactor`, `chore`, `docs`. Feature branches are `feat/<slug>`.
