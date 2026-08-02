# Docs beside the code

The code carries the documentation: the doc comments in [practices.md](practices.md) are what a reader follows. A README
only points into the code and lists what has to be configured.

## Which README

1. Each changed source file belongs to the nearest ancestor directory with a `README.md`; each of those READMEs is in
   scope. Skip tests, lockfiles, generated output and `docs/feats/`.
2. Changed files with no such README get one, in the shallowest directory that owns them and isn't a generic container
   (`src`, `lib`, `app`, `apps`, `packages`, `components`).
3. A change spread across top-level areas with no shared owner updates `docs/ARCHITECTURE.md` instead, when it exists.
   The repo root's `README.md` belongs to the project; leave it alone.
4. A README whose claims still hold stays untouched; fix wrong lines in place.

## README shape

These sections, in this order, nothing else, at most 30 lines:

```markdown
# <Domain>

<One to three sentences: what this owns and why it exists.>

## Entry points

- `path/file.ts:symbol`: what it's for, in a few words.

## Configuration

<Environment variables, then external services. `None.` when there is genuinely nothing to configure.>
```

How it works, usage and gotchas belong in the code's comments, not here.

## Configuration

Find variables in your diff (`process.env`, `import.meta.env`, `os.getenv`, `ENV[`, config schemas, `.env.example`), not
from memory. Every variable the feature reads goes in the table; `solodev check` (C9) fails on one that no README,
`docs/` page or `.env.example` names.

```markdown
| Variable | Required | Purpose | Where the value comes from |
| -------- | -------- | ------- | -------------------------- |
```

External services get the setup a human does outside the repo, copied from `plan.md`'s `## Setup`; never invent steps,
URLs or keys. The commander copies this section into the PR's `## Setup required`. Every `file:symbol` you cite resolves
in the current tree.

## Repo docs

`docs/ARCHITECTURE.md`, when it exists: change only what the feature made wrong, plus one `## Conventions` line when the
diff introduced a pattern other code now goes through (`<what> goes through <symbol> in <path>`). AGENTS.md, when it
exists: only when a command or a constraint changed; keep it short. Create neither.

{{include:fragments/doc-style.md}}
