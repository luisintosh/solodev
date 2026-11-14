# Contributing

One branch, `master`: branch `feat/<slug>` from it and open pull requests against it.

**`skills/` is written only by a release.** It's what `npx skills add luisintosh/solodev` installs, so it changes only
when `pnpm run release` cuts a version. Don't edit, rebuild or copy into `skills/` by hand or in a feature PR; a feature
PR changes `src/` and the release ships it. `pnpm run check` (and CI) fails on any commit other than a `release vX.Y.Z`
commit that touches `skills/`, and on a release commit that touches anything else.

Requires Node ≥22.18 (runs `tools/*.ts` directly via type stripping) and pnpm (`corepack enable`). Run `pnpm install`
once; tests use Vitest and bundles use esbuild.

## Source of truth

| Edit                                 | Then run                       |
| ------------------------------------ | ------------------------------ |
| `src/prompts/**`, `src/catalog.yaml` | `pnpm run build`               |
| `src/cli/**`                         | `pnpm run build` + `pnpm test` |

`dist/` is generated and untracked. `dist/product/` is what a release ships: the skills (with the CLI bundled at
`skills/solo-task/scripts/solodev-cli.mjs`), next to the `README.md`, `LICENSE` and `assets/` at the root. A release
copies `dist/product/skills` to `skills/`; try a build locally with `npx skills add ./dist/product` in a scratch repo.
The shadows go to `dist/{claude,cursor,codex}/agents/` and are copied, as plain files, into
`skills/solo-task/shadows/<host>/`, which the CLI reads and writes on `solodev init`.

`README.md` ships to users, so it describes using solodev; the layout of this repository is below.

```text
src/
  catalog.yaml          models per host and profile, skills, shadows   ← source of truth
  prompts/skills/       role skills and their references               ← source of truth
  prompts/agents/       the shadow shells
  prompts/fragments/    shared includes
  cli/                  the solodev CLI
tools/                  transpile, build-cli, hygiene check, release, evals
evals/                  prompt quiz, stage evals
test/                   e2e-init.sh, fixture repo
skills/                 the installed skills, written only by pnpm run release
dist/                   generated (untracked); dist/product/skills is what a release copies to skills/
```

Skills are named `solo-<name>` (plus `gen-docs`) and shadows `shadow-<name>`, so neither collides with host built-ins
such as Codex's `/review` or Cursor's `code-reviewer`. `solo-task`, `solo-epic` and `gen-docs` are the ones a user
types; the rest are roles the shadows play or that a user can start on their own.

## Hygiene (`pnpm run check`)

Requires a prior `pnpm run build`. Validates:

- `src/catalog.yaml` shape: the three hosts × `think`/`implement` with the pinned models in `tools/models.ts`, the four
  shadows, the seven skills, and a prompt file for each; a shadow's `permission` holds only `edit` path denies
- Prompt rules: each skill within its line budget, no capitalized MUST/NEVER/CRITICAL/ALWAYS, required phrases, every
  `references/` link resolves and every reference is linked
- Emitted skill and shadow frontmatter (and Codex TOML) match the catalog; skills carry no model
- README profile × host matrix and shadow → profile table match the catalog
- `dist/product` holds only `skills/`, `README.md`, `LICENSE` and `assets/`, and its CLI's `init --dry-run` writes
  exactly the built shadows for each host
- Only `release vX.Y.Z` commits touch `skills/`, and they touch nothing else; `skills/` has no uncommitted changes; at a
  release commit, `skills/` equals `dist/product/skills`

## Before committing

```bash
pnpm run build
pnpm run check
pnpm run lint
pnpm run format:check
find . -name '*.sh' -not -path './node_modules/*' -not -path './test/fixture-repo/node_modules/*' -print0 | xargs -0 -n1 bash -n
find . -name '*.sh' -not -path './node_modules/*' -not -path './test/fixture-repo/node_modules/*' -print0 | xargs -0 shellcheck
pnpm test
bash test/e2e-init.sh              # E2E_NPX_SKILLS=1 also runs the real `npx skills add` (network)
```

## Evals

Two tiers, cheapest first:

| Tier  | Command               | When                                              | Usage                                 |
| ----- | --------------------- | ------------------------------------------------- | ------------------------------------- |
| quiz  | `pnpm run eval:quiz`  | after changing a prompt or a description          | one Sonnet call and one Haiku call    |
| stage | `pnpm run eval:stage` | after changing the workflow, and before a release | two headless runs with real subagents |

- `evals/quiz.json` holds the quiz: scenarios (`situation`, `ask`, `expect`) and routing queries (`query`, the `skill`
  that should handle it or `null`). `tools/quiz.ts` gives a model everything a Claude Code install holds
  (`dist/product/skills` and `dist/claude/agents`), asks it what it would do in each scenario and which skill each query
  goes to, then has Haiku grade each answer against `expect`; routing is graded by exact match. Both calls run headless
  on your Claude Code login from an empty temp folder, with no tools, MCP servers, skills or settings; the run fails if
  the init event shows any. `--model <alias>` picks the answering model (default `sonnet`). It prints each failure, each
  `unclear` note (where the model found the files didn't settle a scenario) and the tokens spent, and appends a line to
  `evals/results/quiz.jsonl`. A question tests one decision: put the rest in another question, since a short answer that
  skips a sub-point fails.
- `evals/stages/` holds stage evals: one step of a skill, started from a prepared repo and feature folder, capped in
  turns and graded by scripts. They see what the quiz can't: the tools the agent really calls and what reaches git.
  `pnpm run eval:validate` (also in CI) checks each stage's starting point holds (it needs a prior `pnpm run build`).
  See [evals/stages/README.md](evals/stages/README.md).

## Tooling (TypeScript on Node)

| Script                     | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `node tools/transpile.ts`  | `src/` → `dist/product` (skills, README, assets) + `dist/*/agents`    |
| `node tools/build-cli.ts`  | the CLI into `dist/product/.../scripts/`, the shadows into `shadows/` |
| `node tools/check.ts`      | hygiene                                                               |
| `node tools/quiz.ts`       | prompt quiz: `[--model <alias>]`                                      |
| `node tools/eval-stage.ts` | stage evals: `validate`, `run [--stage <id>] [--changed] [--judge]`   |
| `pnpm run release`         | copy `dist/product/skills` to `skills/` in a release commit, tag it   |

`pnpm run build` runs transpile + build-cli.

## Releasing

Run it on `master`, with a clean tree and nothing to pull; it refuses otherwise. It builds, runs `pnpm run check` and
`pnpm test`, then replaces `skills/` with `dist/product/skills` in one commit, `release vX.Y.Z`, that touches nothing
else. It runs `pnpm run check` on that commit, tags it, and pushes `master` and the tag. Run `pnpm run eval:stage`
first.

```bash
pnpm run release            # patch bump from the latest tag (v1.2.0 → v1.2.1)
pnpm run release --minor
pnpm run release --major
pnpm run release v1.3.0  # explicit version
```

`npx skills add luisintosh/solodev` installs `skills/` from `master`, so users get a change only at the next release; a
pinned install uses `npx skills add luisintosh/solodev@vX.Y.Z`. Annotated tags; don't move published tags, cut a new
patch instead. Tags before v8.1.0 predate the committed `skills/`, so they can't be installed by pin.
