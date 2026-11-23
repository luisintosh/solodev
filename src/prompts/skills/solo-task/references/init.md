# Init and the coder

`/solo-task init [tool]` sets up one coding tool: run `solodev init`, naming the tool if the user did, and show its
report. It writes the coder shadow where that tool reads agents, in the repo or globally, matching where the skills were
installed; `--global` or `--project` overrides when the user asks for the other.

- An `edited` coder shadow is one init didn't write, or one the user changed since; init kept it and printed the
  diff. Show the diff and rerun with `--force` only if the user says so.
- No `AGENTS.md` in the repo: mention `/gen-docs` once, which maps it for every later run.
- Then tell the user to start a new session before the next `/solo-task` (coding tools load agents at startup), and to
  run `/solo-task init` in each other coding tool they use.

## The coder

`/solo-task coder [<tool>] [<model>/<effort> | session | default]` shows or sets what the coder starts on: run
`solodev coder` with the user's words and show its report. A short value such as `opus/high` or `sol/xhigh` is enough;
`session` runs the coder on the session's model, `default` goes back to solodev's. It applies from the next run, with
no init or new session. Every other role always runs on the session's model and effort, which the user picks with the
tool's own model and effort settings.
