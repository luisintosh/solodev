# Orca workers

A shadow runs as an Orca worker. Use the `orchestration` skill for every Orca step.

- Launch: a supervised worker in the current worktree, with `--agent`, `--model` and `--effort` from `solodev probe`:
  the coder's from its writer's `launch` (`progress.md` records the choice), the reviewer's and verifier's from the home
  tool's `launch.think`.
- Task: "Use the `arise-<role>` skill at <absolute SKILL.md path>. Your brief is <brief path>; write your reply to
  <reply path> and report it with `worker_done`." Briefs and replies live in the feature folder's `briefs/`.
- Coder: one worker for the whole feature; later journeys and fix rounds go to it as new tasks. Release it once code
  review is settled.
- Reviewer and verifier: a new worker each time, released after its reply, so each starts fresh.
- Answer worker questions from the spec and plan; ask the user when they can't.
- If a worker can't start or stops responding, ask the user: run that shadow natively on the home tool, or wait.
