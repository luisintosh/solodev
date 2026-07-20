# PR and finish

**Draft PR (step 7).** `gh pr create --draft` against the default branch. The body: what changed in three to five
bullets, the scenarios and the journey tests that prove them, findings deferred or dropped, and `Closes #<n>` for an
issue run.

**Finish (step 9).**

1. Read the `## Configuration` section of each README the documenter wrote. Anything beyond `None.` goes into the PR
   body under `## Setup required`, naming its README. Replace an existing section rather than adding a second.
2. `gh pr ready <url>`.
3. The finish card: the PR link, the QA comment link if any, scenarios passing, review rounds and attempts used, the
   setup lines, and each deferred finding as a follow-up ticket with a title and body ready to paste. You don't file
   them.
4. Handoff, for an issue that belongs to a roadmap epic: take the first unchecked `- [ ] #<n>` entry in the epic that
   isn't this feature. If its `Blocked by` issues are all closed, say it's ready; otherwise say this PR has to merge
   first. Print the line to run next: `/arise #<n>`.

Without gh, use a connected tool that can do the same (an MCP server, a skill or a CLI) and name it in one line. If
nothing can open a PR, tell the user and stop.
