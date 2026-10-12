# Orca workers

A shadow runs as an Orca worker. Use the `orchestration` skill for every Orca step.

- Launch: a supervised worker in the current worktree, on the tool, model and effort for that shadow: the coder's from
  the `Solodev-Writer` trailer, the reviewer's and verifier's from the home tool's `think` model in `solodev probe`, the
  documenter's from its `implement` model.
- Task: "Use the `arise-<role>` skill at <absolute SKILL.md path>. Your brief is <brief path>; write your reply to
  <reply path> and report it with `worker_done`." Briefs and replies live in `.git/solodev/<slug>/`.
- Coder: one worker for the whole feature; later journeys and fix rounds go to it as new tasks. Release it once code
  review is settled.
- Reviewer, verifier and documenter: a new worker each time, released after its reply, so each starts fresh.
- Answer worker questions from the spec and plan; ask the user when they can't.
- If a worker can't start or stops responding, ask the user: run that shadow natively on the home tool, or wait.
