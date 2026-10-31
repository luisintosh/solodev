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

- **One reviewer** for a small or simple change that isn't sensitive: a few files and one journey, or mostly mechanical
  edits (renames, config, copy, tests only). Its brief says `lens: single` and lists the lenses; it reads them all and
  writes `review.md` itself.
- **One reviewer per lens, all started in the same turn**, for a large change (many files, several journeys, a new
  module, an edit that cuts across layers) or a sensitive one, whatever its size. When unsure, go parallel: a lens that
  finds nothing costs less than a missed blocker.

Each reviewer gets a fresh agent and its own brief, `briefs/reviewer-<lens>-<round>.md` in the feature folder, with the
reply beside it: solodev-review's absolute `SKILL.md` path, the slug, the base, the coder's `decisions:`, the `- tools:`
line, the `solodev` path, `lens: <name>` and, on re-review, the rows it rechecks. Start them in parallel with Claude
Code's Agent tool (`shadow-reviewer`), Codex's `spawn_agent` or Cursor's Task tool, one call each in the same turn, or
as one Orca worker each (solodev-mission's `references/orca.md`); on any other coding tool use one reviewer. Tell the
user the choice in one line:
`→ review: 4 lenses in parallel (evidence, contract, correctness, design): 14 files, 3 journeys`.

## Merge the lenses

- A lens that stops or writes no reply starts once more, fresh. If it fails again, merge without it, name it in your
  notes and tell the user; evidence, and security on a sensitive change, you can't do without: ask the user whether to
  retry, review that lens yourself, or go on without it.
- Two findings at the same location with the same cause are one row: the higher severity, both lenses in its `lens` cell
  (`contract, correctness`), and its text starts `Weakened test:` when any of them did.
- A finding that matches a row already in `review.md` updates that row instead of adding one. The rest take the next
  free ids, status `open`, in the format SKILL.md gives. No findings from any lens: the header row alone.
- Count by severity after merging, and join the notes; a spec or plan gap among them goes to the user.

## Re-review

Pick the lenses and choose one reviewer or several the same way, on the fix diff since the commit the last review saw;
an open security row makes it sensitive. Evidence runs every time: the journeys and the project checks again at HEAD.

- **One reviewer**, `lens: single`, rechecks every open row and reads the fix diff through every lens picked for it.
- **Several:** the lenses picked for the fix diff, plus each lens named in an open row's `lens` cell. Give each lens the
  rows its cell names; a row whose cell names no lens (`single`, or a `review.md` from before the column) goes to the
  lens that fits it best. Each lens returns a result per row it was given and new findings in the fix diff. A row given
  to two lenses stays `open` if either says so, else is `rebutted` if either rebuts (both reasons, and never on a
  `Weakened test:` row, which stays `open`), else `fixed`. Write the statuses and reasons into `review.md`, and new
  findings under the next free ids.
