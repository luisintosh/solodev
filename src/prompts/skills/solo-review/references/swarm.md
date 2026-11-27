# Running a code review

The session that starts the review runs this: the commander at `/solo-task`'s code review, or your own session when the
user runs `/solo-review` directly. A reviewer started from a brief never runs it: its brief says to start no
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

Each brief, in its spawn call: solo-review's absolute `SKILL.md` path, the slug, the feature folder, the base, the
coder's `decisions:`, the `- tools:` line, the `solodev` path, `lens: <name>` and, on re-review, the rows it rechecks;
then that it reports and doesn't fix, changes only `review.md`, and starts no subagents. Spawn each as a fresh generic
subagent with one call, the parts every brief shares first and the lens last, so the lenses share a prompt cache; on a
coding tool with no subagents use one reviewer. Tell the user the choice in one line:
`→ review: 3 lenses in parallel (evidence, correctness, design): 14 files, 3 journeys`.

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

## Fix rounds and re-review

In a `/solo-task` run the coder answers the findings in fix rounds, each followed by a re-review; run on your own, stop
at the findings.

- **A round opens** on an open blocker or major, or a QA failure in code. A `Weakened test:` row goes straight to the
  user instead, who picks a fix round, `rebutted` or `deferred`. A minor, new or old, never starts another fix round on
  its own.
- **A round carries** every open blocker, major and failed QA scenario, plus the open minors except those whose text
  starts `Pre-existing:` or `Tech debt:`. Those, and any minor still open at the end, go to the PR's Follow-ups.
- **The re-review** is one reviewer, `lens: single`, whatever the size of the first review, on the fix diff since the
  commit the last review saw. A security row is open: start a second fresh reviewer with `lens: security` in the same
  turn. It gets the rows whose `lens` cell names security and replies with a result per row and any new finding; the
  single reviewer gets the rest, runs the journey commands at HEAD and judges the coder's `checks:` from their output
  instead of rerunning them, except the project's full `test`, which it runs itself when no fix round's `checks:` shows
  one. Write security's results into `review.md` once both have replied.
- **Budget:** up to three rounds, each with its re-review, while a blocker, major or QA failure is open. A row still
  open after two rounds goes to the user, and so does whatever is open after the third re-review: another fix round,
  which can run on a stronger `<model>/<effort>` for the coder, `deferred` or `dropped`, written into `review.md`.
- **A change after a reopened gate** is reviewed as a first review, on the diff since the last review, its lenses
  picked as above, with the budget starting over.
