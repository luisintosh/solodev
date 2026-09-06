# Orca workers

A shadow runs as an Orca worker. Use the `orchestration` skill for every Orca step.

- Launch: a supervised worker in the current worktree, with `--agent`, `--model` and `--effort` from `solodev probe`:
  the coder's from its writer's `launch` (`progress.md` records the choice), the reviewer's and verifier's from the home
  tool's `launch.think`.
- Task: the brief itself as `--spec`, starting "Use the `solodev-<skill>` skill at <absolute SKILL.md path>", and ending
  "Write your reply to <reply path> and pass it as `--report-path` to `worker_done`." `worker_done` carries only a short
  summary, so the reply goes to `review-output/<role>[-<lens>]-<n>.md` in the feature folder, which you create first;
  `<n>` is the attempt or round, and a lens reviewer's path names its lens so parallel workers never share a file.
- Coder: one worker for the whole feature; fix rounds go to it as new tasks. Release it once code review is settled.
- Reviewer and verifier: a new worker each time, released after its reply, so each starts fresh. Lens reviewers are one
  worker per lens, launched together; one that fails follows `swarm.md`.
- Answer worker questions from `spec.md`; ask the user when they can't.
- If a worker other than a lens reviewer can't start or stops responding, ask the user: run that shadow natively on the
  home tool, or wait.
