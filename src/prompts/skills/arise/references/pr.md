# PR and finish

**Draft PR (step 7).** `gh pr create --draft` against the default branch. The body opens with one line linking the
feature's `spec.md`, `plan.md` and `progress.md` on the branch (full URLs from `gh repo view --json url`), then: what
changed in three to five bullets, the scenarios and the journey tests that prove them, findings deferred or dropped, and
`Closes #<n>` for an issue run.

**Finish (step 9).**

1. Read `plan.md`'s `## Setup` and the `## Configuration` section of each README the diff touched. Anything beyond
   `None.` goes into the PR body under `## Setup required`, naming where it came from. Replace an existing section
   rather than adding a second.
2. Write `## Follow-ups` into the PR body, replacing an existing one: each `deferred` finding and open `minor`
   (including `Tech debt:` ones) and each `waived` QA scenario, one line each with its id and why it was left. Write
   `None.` when there are none. This is where the merger sees what's left.
3. `gh pr ready <url>`.
4. The finish card: the PR link, the QA comment link if any, scenarios passing, review rounds and attempts used, the
   setup lines, and the follow-ups again, each as a ticket title and body ready to paste. You don't file them.
5. Handoff, for an issue that belongs to a roadmap epic: take the first unchecked `- [ ] #<n>` entry in the epic that
   isn't this feature. If its `Blocked by` issues are all closed, say it's ready; otherwise say this PR has to merge
   first. Print the line to run next: `/arise #<n>`.

Without gh, use a connected tool that can do the same (an MCP server, a skill or a CLI) and name it in one line. If
nothing can open a PR, tell the user and stop.
