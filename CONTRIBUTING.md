# Contributing

Requires Node ≥22.18 (runs `tools/*.ts` directly via type stripping) and pnpm (`corepack enable`). Run `pnpm install`
once; tests use Vitest and bundles use esbuild.

## Source of truth

| Edit                                 | Then run                       |
| ------------------------------------ | ------------------------------ |
| `src/prompts/**`, `src/catalog.yaml` | `pnpm run build`               |
| `src/cli/**`                         | `pnpm run build` + `pnpm test` |
| `tools/install.ts`                   | `pnpm run build`               |

`dist/` and `manifest.txt` are **generated and tracked** so clients install without a build. Never hand-edit them. After
any `src/` change run `pnpm run build` before commit; CI fails if they drift.

Skills are named `arise` or `arise-<role>` and shadows `shadow-<name>`, so neither collides with host built-ins such as
Codex's `/review` or Cursor's `code-reviewer`.

## Hygiene (`pnpm run check`)

Requires a prior `pnpm run build`. Validates:

- `src/catalog.yaml` shape: the three hosts × `think`/`implement` with the pinned models in `tools/models.ts`, the two
  shadows, the eight skills, and a prompt file for each
- Prompt rules: each skill within its line budget, no capitalized MUST/NEVER/CRITICAL/ALWAYS, required phrases, every
  `references/` link resolves and every reference is linked
- Emitted skill and shadow frontmatter (and Codex TOML) match the catalog
- README profile × host matrix and shadow → profile table match the catalog
- `manifest.txt` hashes match `dist/`
- `dist/install.js` is present and matches a rebuild of `tools/install.ts`

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

- `evals/<skill>/` holds prompt-behavior evals in the skill-creator format, run against a copy of `test/fixture-repo`:
  `evals.json` (task prompts + expectations) and `trigger-evals.json` (should/shouldn't-trigger queries for the
  description optimizer). After changing a prompt or a catalog `description`, rerun the matching set with the
  skill-creator skill.
- `evals/outcome/` holds outcome evals: feature tasks with held-out acceptance tests, run headless per config and scored
  after the agent finishes. `pnpm run eval:validate` (also in CI) proves each task's tests fail on the fixture and pass
  on its reference solution; `node tools/eval.ts run` and `report` need the coding tools and spend real usage. See
  [evals/outcome/README.md](evals/outcome/README.md).

## Tooling (TypeScript on Node)

| Script                        | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `node tools/transpile.ts`     | `src/` → `dist/{claude,cursor,codex}` + `dist/agents/skills`            |
| `node tools/install.ts`       | installer source (Clack + copy); emitted as `dist/install.js`           |
| `node tools/build-cli.ts`     | portable Node ESM `dist/bin/solodev.mjs`                                |
| `node tools/build-install.ts` | `tools/install.ts` → `dist/install.js` (esbuild, Node ESM for npx/bunx) |
| `node tools/gen-manifest.ts`  | `manifest.txt` from `dist/`                                             |
| `node tools/check.ts`         | hygiene                                                                 |
| `node tools/eval.ts`          | outcome evals: `validate`, `run --config <id>`, `report`                |
| `pnpm run release`            | tag HEAD, push, publish a GitHub Release                                |

`pnpm run build` runs transpile + build-cli + gen-manifest + build-install.

## Releasing

Tags HEAD (the latest commit), pushes the branch and tag, and publishes a GitHub Release. Installers pin a ref with
`npx -y github:luisintosh/solodev#vX.Y.Z` or `bunx github:luisintosh/solodev#vX.Y.Z` (default branch is `master`).

```bash
pnpm run release            # patch bump from the latest tag (v1.2.0 → v1.2.1)
pnpm run release --minor
pnpm run release --major
pnpm run release v1.3.0  # explicit version
```

Publishing a GitHub Release runs CI’s `release-assets` job, which uploads `solodev-dist.tar.gz` (`dist/` +
`manifest.txt`). Annotated tags; don’t move published tags — cut a new patch instead.
