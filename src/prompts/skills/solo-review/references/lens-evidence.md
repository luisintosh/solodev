# Evidence lens

You run things; the other lenses only read. Judge each command by its output, not only its exit code. The commands are
the brief's `- tools:` line and each journey's `command` in the plan. Test files in the diff are under review too, not
evidence.

- **Fail, then pass.** Run each journey's command, with the journey tests copied in, on the base (a temporary worktree
  outside the repo, with its dependencies working, removed afterwards) and at HEAD. A journey that passes on the base,
  fails at HEAD, or fails on the base for any reason but the missing behavior (a broken import unrelated to the feature,
  a runner that never started) is a `blocker`. One that failed only on loading new code proves no assertion; check that
  its assertions pin each Then.
- **Project checks.** Typecheck, lint, test and build, where the repo has them. A failure in code the feature touched is
  a `blocker` naming the command and the output lines that matter; one elsewhere goes in `notes`.
- **Tests not weakened.** Compare each journey test with its first committed version and every other changed test with
  the base. A skip or focus marker added, a test deleted, or an assertion removed or loosened is a `major` whose text
  starts `Weakened test:` and names the `git diff` to show; the user decides it.
- **Config documented.** Undocumented config, as below, is a `major`.

On re-review, run the journeys and the project checks again at HEAD.

{{include:fragments/practices-evidence.md}}
