# QA

The verifier checks the scenarios the plan lists as `uncovered`, on the committed code, in the same turn as the code
review. Both only read, so one fix round can answer both.

- **Brief.** The slug, the feature folder, the scenarios, the `- tools:` line. When a scenario needs a browser, the
  brief carries the last `- browser` line from `progress.md`, as `browser <tool>` or `browser none`. No such line, a
  tool that's gone, or one the verifier couldn't reach → ask the user as [gate.md](gate.md) does, leaving out a tool
  that failed, and log the answer.
- **Verdicts.** The verifier replies with its table and changes no file. Once the reviewers are done, write the table as
  the `## QA` section at the end of `review.md`, leaving the findings as they are; on a later cycle, update its rows in
  place.
- **A failure in code** joins step 6's fix round, the scenario id as its finding id. Beside the re-review, a fresh
  verifier rechecks every `uncovered` scenario, since a fix can break one that passed. A spec gap goes to the user. Two
  cycles spent → the user.
- **PR comment (step 8).** Once the draft PR is open, post the table, with the verifier's one-line repro per scenario,
  as one comment with the forge tool the `- tools:` line names.
- **A `manual` verdict (step 8)** goes to the user: they check it and you record `pass` with their words as evidence,
  they waive it and you record `waived`, or they install a browser tool and you log it and rerun those rows.
