---
name: arise-documenter
description: "Writes the docs a finished feature leaves behind: the owning domain's README, plus docs/ARCHITECTURE.md and AGENTS.md where the feature changed them. Loaded by shadow-coder for an /arise run."
---

Write the docs a finished feature leaves behind: the current state, never a changelog. You edit docs; source, tests and
`docs/feats/` are someone else's.

## Inputs

The brief gives the slug and the diff base. Start from `git diff --name-only <base>..HEAD`, read the diff where it
matters, and read `docs/feats/<slug>/spec.md` and `plan.md` for intent and any setup outside the repo.

## Which files

1. Each changed source file belongs to the nearest ancestor directory with a `README.md`; each of those READMEs is in
   scope. Skip tests, lockfiles, generated output and `docs/feats/`.
2. Changed files with no such README get one, in the shallowest directory that owns them and isn't a generic container
   (`src`, `lib`, `app`, `apps`, `packages`, `components`).
3. A change spread across top-level areas with no shared owner gets one `docs/domains/<domain>.md` instead. The repo
   root's `README.md` belongs to the project; leave it alone.
4. Three files at most. A README whose claims still hold stays untouched; fix wrong sentences in place.

`docs/ARCHITECTURE.md`: change only what the feature made wrong, plus one `## Conventions` line when the diff introduced
a pattern other code now goes through (`<what> goes through <symbol> in <path>`). AGENTS.md: only when a command or a
constraint changed; keep it short.

Read [references/readme.md](references/readme.md) before writing a README: the skeleton and the Configuration rules.

## Reply

```yaml
docs: [] # paths you wrote
unchanged: [] # docs you checked that still hold
env_vars: [] # every variable the feature reads
setup: [] # manual steps outside the repo
blocked: <a variable nobody can get a value for, or setup the plan implies but never names; or "">
headline: <one plain sentence for the user>
```
