# Running a code review

The session that starts the review runs this: the commander at `/solodev-mission`'s code review, or your own session
when the user runs `/solodev-review` directly. A reviewer started from a brief never runs it, since a subagent can't
start subagents.

## Pick the lenses

Read `git diff --stat <base>..HEAD`, the untracked files and the plan's journeys.

- **evidence**, **correctness** and **design**: every review.
- **contract**: when the change adds or alters behavior a scenario pins; not for a pure refactor.
- **security**: when the change is sensitive: auth or permissions, payments, secrets, migrations or data deletion,
  concurrency, a public API or wire format.
- **ui**: when the diff touches anything the user sees: components, templates, styles, user-facing copy, screens.

## One reviewer or one per lens

- **One reviewer** for a small or simple change that isn't sensitive: a few files, one journey, or mostly mechanical
  edits (renames, config, copy, tests only). Its brief says `lens: single` and lists the lenses; it reads them all and
  writes `review.md` itself.
- **One reviewer per lens, all started in the same turn**, for a large change (many files, several journeys, a new
  module, an edit that cuts across layers) or a sensitive one, whatever its size. When unsure, go parallel: a lens that
  finds nothing costs less than a missed blocker.

Claude Code, Codex, Cursor and Orca start lens reviewers in parallel; on any other coding tool use one reviewer. Each
reviewer gets its own fresh agent, brief and reply file: the slug, the base, the coder's `decisions:`, the `- tools:`
line, the `solodev` path and `lens: <name>`. Tell the user the choice in one line:
`→ review: 4 lenses in parallel (evidence, contract, correctness, design): 14 files, 3 journeys`.

## Merge the lenses

- A lens that stops or writes no reply starts once more, fresh. If it fails again, merge without it, name it in your
  notes and tell the user.
- Two findings at the same location with the same cause are one row: the higher severity, both lenses in its `lens` cell
  (`contract, correctness`).
- Rows take the next free ids after any already in `review.md`, status `open`, in the format SKILL.md gives. No findings
  from any lens: the header row alone.
- Sum the counts and join the notes; a spec or plan gap among them goes to the user.

## Re-review

Choose the same way on the fix diff since the commit the last review saw; an open security row makes it sensitive.

- **One reviewer**, `lens: single`, rechecks every open row and the fix diff.
- **Several:** each lens that owns an open row, plus evidence, which runs the tests and checks again. Each returns a
  result per row it owns and new findings in the fix diff. A row owned by two lenses is `fixed` only when both say so.
  Write the statuses and reasons into `review.md`, and new findings under the next free ids.
