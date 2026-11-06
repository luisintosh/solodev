# Init

`/mission init [tool]` sets up one coding tool: run `solodev init`, naming the tool if the user did, and show its
report. It writes the two shadows where that tool reads agents, in the repo or globally, matching where the skills were
installed; `--global` or `--project` overrides when the user asks for the other.

- An `edited` shadow is one init didn't write, or one the user changed since; init kept it and printed the diff. Show
  the diff and rerun with `--force` only if the user says so.
- No `AGENTS.md` in the repo: mention `/gen-docs` once, which maps it for every later run.
- Then tell the user to start a new session before the next `/mission` (coding tools load agents at startup), and to run
  `/mission init` in each other coding tool they use.
