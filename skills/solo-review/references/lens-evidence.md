# Evidence lens

You judge whether the tests prove the scenarios, and you run things; the other lenses only read. Judge each command by
its output, not only its exit code. The commands are the brief's `- tools:` line and each journey's `command` in the
plan. Test files in the diff are under review too, not evidence. With no plan in `spec.md`, as on a branch reviewed
outside a `/solo-task` run, run only the project checks.

- **Scenarios pinned.** Walk each scenario and journey through the diff to the code that makes its Then hold and the
  assertion that proves it; a scenario its journey test doesn't really pin is a `major`.

- **Fail, then pass.** `progress.md` holds the coder's runs, a `- proof <journey> red` and a `green` per journey with
  the last lines of each output; journeys whose greens came from one run share its lines, which show each one's test
  ran. Read the red: one that failed for any reason but the missing behavior (a broken import unrelated to the feature,
  a runner that never started) is a `blocker`; one that failed only on loading new code proves no assertion, so check
  that its assertions pin each Then. A journey with no red record goes in `notes`. Then run each journey's command at
  HEAD: one that fails, or that ran none of its tests, is a `blocker`.
- **Project checks.** Typecheck, lint, test and build, where the repo has them. A failure in code the feature touched is
  a `blocker` naming the command and the output lines that matter; one elsewhere goes in `notes`.
- **Tests not weakened.** Compare each journey test with its first committed version and every other changed test with
  the base; a `Weakened test:` finding (below) names the `git diff` to show.

## Contract

- **Scenarios hold:** each changed path does what its scenario's Given/When/Then says, not only its test going green.
- **Coverage, both ways:** every changed code path maps to a scenario, and every scenario is asserted by its journey
  test through the public boundary, not by a unit test of an internal helper. The second direction is the one that ships
  untested.

## Tests

- **Test quality:** tests assert behavior, not implementation; none passes only because a mock was called or relies on
  another test's order or leftovers. A test skipped, focused or deleted, or an assertion removed or loosened, is a
  `major` whose text starts `Weakened test:`; the user decides it.
- **Config documented:** a variable or setting the change starts reading is named in a README, a `docs/` page or the env
  template; one that isn't is a `major`.
