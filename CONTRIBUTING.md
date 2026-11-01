# Contributing

Requires Node ≥22.18 (runs `tools/*.ts` directly via type stripping) and pnpm (`corepack enable`). Run `pnpm install`
once; tests use Vitest and bundles use esbuild.

## Source of truth

| Edit                                 | Then run                       |
| ------------------------------------ | ------------------------------ |
| `src/prompts/**`, `src/catalog.yaml` | `pnpm run build`               |
| `src/cli/**`                         | `pnpm run build` + `pnpm test` |
| `tools/install.ts`                   | `pnpm run build`               |

`dist/`, `manifest.txt` and `bin/install.js` are generated. Never hand-edit them. Git tracks only `bin/install.js`,
which npx/bunx run from a git ref. That installer downloads `solodev-dist.tar.gz` (`dist/` plus `manifest.txt`) from the
GitHub Release named in `release.json` and checks its sha256 before installing. In a built checkout it uses the local
`dist/` instead. After a `tools/install.ts` change run `pnpm run build` before commit; CI fails if `bin/install.js`
drifts.

Skills are named `solodev-mission` or `solodev-<action>` and shadows `shadow-<name>`, so neither collides with host
built-ins such as Codex's `/review` or Cursor's `code-reviewer`.

## Hygiene (`pnpm run check`)

Requires a prior `pnpm run build`. Validates:

- `src/catalog.yaml` shape: the three hosts × `think`/`implement` with the pinned models in `tools/models.ts`, the two
  shadows, the seven skills, and a prompt file for each; a shadow's `permission` holds only `edit` path denies
- Prompt rules: each skill within its line budget, no capitalized MUST/NEVER/CRITICAL/ALWAYS, required phrases, every
  `references/` link resolves and every reference is linked
- Emitted skill and shadow frontmatter (and Codex TOML) match the catalog
- README profile × host matrix and shadow → profile table match the catalog
- `manifest.txt` hashes match `dist/`
- `bin/install.js` is present and matches a rebuild of `tools/install.ts`

## Before committing

```bash
pnpm run build
pnpm run check
pnpm run lint
pnpm run format:check
find . -name '*.sh' -not -path './node_modules/*' -not -path './test/fixture-repo/node_modules/*' -print0 | xargs -0 -n1 bash -n
find . -name '*.sh' -not -path './node_modules/*' -not -path './test/fixture-repo/node_modules/*' -print0 | xargs -0 shellcheck
pnpm test
bash test/e2e-install.sh
```

## Evals

Two tiers, cheapest first:

| Tier  | Command               | When                                              | Usage                                 |
| ----- | --------------------- | ------------------------------------------------- | ------------------------------------- |
| quiz  | `pnpm run eval:quiz`  | after changing a prompt or a description          | one Sonnet call and one Haiku call    |
| stage | `pnpm run eval:stage` | after changing the workflow, and before a release | two headless runs with real subagents |

- `evals/quiz.json` holds the quiz: scenarios (`situation`, `ask`, `expect`) and routing queries (`query`, the `skill`
  that should handle it or `null`). `tools/quiz.ts` gives a model everything `dist/claude` installs, asks it what it
  would do in each scenario and which skill each query goes to, then has Haiku grade each answer against `expect`;
  routing is graded by exact match. Both calls run headless on your Claude Code login from an empty temp folder, with no
  tools, MCP servers, skills or settings; the run fails if the init event shows any. `--model <alias>` picks the
  answering model (default `sonnet`). It prints each failure, each `unclear` note (where the model found the files
  didn't settle a scenario) and the tokens spent, and appends a line to `evals/results/quiz.jsonl`. A question tests one
  decision: put the rest in another question, since a short answer that skips a sub-point fails.
- `evals/stages/` holds stage evals: one step of a skill, started from a prepared repo and feature folder, capped in
  turns and graded by scripts. They see what the quiz can't: the tools the agent really calls and what reaches git.
  `pnpm run eval:validate` (also in CI) checks each stage's starting point holds (it needs a prior `pnpm run build`).
  See [evals/stages/README.md](evals/stages/README.md).

## Tooling (TypeScript on Node)

| Script                        | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `node tools/transpile.ts`     | `src/` → `dist/{claude,cursor,codex}` + `dist/agents/skills`           |
| `node tools/install.ts`       | installer source (Clack + copy); emitted as `bin/install.js`           |
| `node tools/build-cli.ts`     | portable Node ESM `dist/bin/solodev-cli.mjs`                           |
| `node tools/build-install.ts` | `tools/install.ts` → `bin/install.js` (esbuild, Node ESM for npx/bunx) |
| `node tools/gen-manifest.ts`  | `manifest.txt` from `dist/`                                            |
| `node tools/check.ts`         | hygiene                                                                |
| `node tools/quiz.ts`          | prompt quiz: `[--model <alias>]`                                       |
| `node tools/eval-stage.ts`    | stage evals: `validate`, `run [--tier smoke] [--changed] [--judge]`    |
| `pnpm run release`            | tag HEAD, push, publish a GitHub Release                               |

`pnpm run build` runs transpile + build-cli + gen-manifest + build-install.

## Releasing

Builds the payload, packs `solodev-dist.tar.gz`, writes its tag and sha256 to `release.json`, and rebuilds
`bin/install.js`. It commits both as `chore: release vX.Y.Z` and tags that commit. Then it pushes the branch and the tag
and publishes a GitHub Release with the tarball attached. Installers pin a ref with
`npx -y github:luisintosh/solodev#vX.Y.Z` or `bunx github:luisintosh/solodev#vX.Y.Z` (default branch is `master`).

Run it on `master`, with a clean tree and nothing to pull; it refuses otherwise. It prints the tarball's path. If it
fails after pushing, publish that same file with `gh release create vX.Y.Z <path> --verify-tag`.

```bash
pnpm run release            # patch bump from the latest tag (v1.2.0 → v1.2.1)
pnpm run release --minor
pnpm run release --major
pnpm run release v1.3.0  # explicit version
```

The installer on `master` installs the release that `release.json` names, so commits after a release reach users only at
the next release. Annotated tags; don’t move published tags — cut a new patch instead.
