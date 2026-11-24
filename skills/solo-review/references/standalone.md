# Reviewing without a brief

The user started you to review the current branch's code, so you find what a brief would name:

- **The feature folder.** On `feat/<slug>`, `<state.dir>/<slug>/` (`state.dir` from `solodev probe`, the solo-task
  skill's `scripts/solodev-cli.mjs`); with no `spec.md` there, ask the user what the change should do. On another
  branch, `<state.dir>/reviews/<branch>/`, `/` written as `-`.
- **The base.** The merge-base with the branch the PR targets, else the default branch.
