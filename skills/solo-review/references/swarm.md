# Running a code review

The session that starts the review runs this: the commander at `/solo-task`'s code review, or your own session when the
user runs `/solo-review` directly. A reviewer started from a brief never runs it, since a subagent can't start
subagents.

## Pick the lenses

Read `git diff --stat <base>..HEAD`, the untracked files and the plan's journeys.

- **evidence**, **correctness** and **design**: every review.
- **security**: when the change is sensitive: auth or permissions, payments, secrets, migrations or data deletion,
  concurrency, a public API or wire format.
- **ui**: when the diff touches anything the user sees: components, templates, styles, user-facing copy, screens.

## One reviewer or one per lens

- **One reviewer** for a small or simple change that isn't sensitive: a few files and one journey, or mostly mechanical
  edits (renames, config, copy, tests only). Its brief says `lens: single` and lists the lenses; it reads them all and
  writes `review.md` itself.
- **One reviewer per lens, all started in the same turn**, for a large change (many files, several journeys, a new
  module, an edit that cuts across layers) or a sensitive one, whatever its size. When unsure, go parallel: a lens that
  finds nothing costs less than a missed blocker.

Each reviewer gets a fresh agent and replies in its final message. Its brief, in the spawn call: solo-review's absolute
`SKILL.md` path, the slug, the feature folder, the base, the coder's `decisions:`, the `- tools:` line, the `solodev`
path, `lens: <name>` and, on re-review, the rows it rechecks. Start them in parallel with Claude Code's Agent tool
(`shadow-reviewer` for every lens), Codex's `spawn_agent` or Cursor's Task tool, one call each in the same turn; on any other coding tool use one reviewer. Tell the
user the choice in one line: `→ review: 3 lenses in parallel (evidence, correctness, design): 14 files, 3 journeys`.

## Merge the lenses

- A lens that stops or writes no reply starts once more, fresh. If it fails again, merge without it, name it in your
  notes and tell the user. For evidence, or security on a sensitive change, ask the user instead: retry, review that
  lens yourself, or go on without it.
- Two findings at the same location with the same cause are one row: the higher severity, both lenses in its `lens` cell
  (`evidence, correctness`), and its text starts `Weakened test:` when any of them did.
- A finding that matches a row already in `review.md`'s findings updates that row instead of adding one. The rest take
  the next free ids, status `open`, in the format SKILL.md gives. No findings from any lens: the header row alone. A
  `## QA` section stays as it is.
- Count by severity after merging, and join the notes; a spec or plan gap among them goes to the user.

## Re-review

One reviewer, `lens: single`, whatever the size of the first review. On the fix diff since the commit the last review
saw, it rechecks every row the coder replied to, reads the fix diff through the first review's lenses, and runs the
journeys and the project checks again at HEAD.

- **A security row is open:** start a second fresh reviewer with `lens: security` in the same turn. It gets the rows
  whose `lens` cell names security and replies with a result per row and any new finding; the single reviewer gets the
  rest. Write security's results into `review.md` once both have replied.
- **A new minor** in the fix diff is written as an open row and never starts another fix round; the PR lists it under
  Follow-ups. A new blocker or major goes to the user with the rows still open.
