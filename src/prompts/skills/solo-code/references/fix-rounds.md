# Fix rounds

## Testing a fix

Test what the fix can reach: `test_file` from the `- tools:` line on the tests of the files you changed, then every
journey's command. Run the full `test` as well when the fix changes code that other parts of the repo use, and say in
`checks:` which ran; the re-reviewer runs the full `test` itself when no fix round's `checks:` shows one.

Where several of those tests share a runner, run them in one invocation that names each test file or test, rather than
one run each, since starting the runner can cost more than the tests. A run that covers several journeys' tests records
their green together, `solodev proof <slug> J1,J2 green --exit <its exit code> < <its output>`, and its output shows
each journey's test ran. A red stays one journey per run.
