# Code review checklist

One pass over the whole diff covers all three areas. Test files in the diff are under review too, not evidence.

## Evidence

Run these yourself; judge each by its output, not only its exit code. The commands are the brief's `- tools:` line and
each journey's `command` in `plan.md`.

- **Fail, then pass.** Check out the base in a temporary worktree outside the repo, get its dependencies working, copy
  in the journey tests, and run each journey's command there; then run it at HEAD. Remove the worktree when done. A
  journey that passes on the base, fails at HEAD, or fails on the base for any reason but the missing behavior (a broken
  import unrelated to the feature, a runner that never started) is a `blocker`. One that failed only on loading new code
  proves no assertion; check that its assertions pin each Then.
- **Project checks.** Typecheck, lint, test and build, where the repo has them. A failure in code the feature touched is
  a `blocker` naming the command and the output lines that matter; one elsewhere goes in `notes`.
- **Tests not weakened.** Compare each journey test with its first committed version and every other changed test with
  the base. A skip or focus marker added, a test deleted, or an assertion removed or loosened is a `major` whose text
  starts `Weakened test:` and names the `git diff` to show; the user decides it.
- **Config documented.** A variable or setting the diff starts reading that no README, `docs/` page or env template
  names is a `major`.

{{include:fragments/practices.md}}

## Structure findings

A structural finding counts only when the diff introduces or extends the smell; search for the other sites before
claiming two or more. A convention written in `docs/ARCHITECTURE.md`, when it exists, counts as a project rule. Sites in
the diff are fixed now; sites outside it are fixed in the same round when that stays within about five files and 150
lines and each has a test that runs it. The rest becomes a `minor` finding whose text starts `Tech debt:`; open minors
don't block, and the finish card suggests each as a ticket.

A missing doc comment on a new export is `minor` when the repo already uses them, and so is a padded one (restates the
signature, runs to paragraphs). A doc comment or README that contradicts the code is `major`.

A large diff: review the riskiest files first and name in your reply what you didn't reach.
