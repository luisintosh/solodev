# PR and finish

**Draft PR (step 7).** A draft pull or merge request against the default branch, with the forge tool the `- tools:` line
names. The spec and plan stay outside the repo, so the body carries what a reviewer, human or agent, needs from them,
and nothing the diff, the ticket or the QA comment already holds. Use these sections in this order and drop an empty
one, except `## Follow-ups`:

```markdown
Closes #2510. Lets staff record payments that don't match a customer yet.

## What changed

- Payments can be saved without a customer; the database rule now allows it.
- The payments list gets an "Unidentified" filter.

<details>
<summary>Scenarios: 2 (1 tested, 1 QA)</summary>

| id  | Then                               | proof                          |
| --- | ---------------------------------- | ------------------------------ |
| @S1 | the payment saves with no customer | test/payments/unlinked.test.ts |
| @S2 | the filter shows only unidentified | QA                             |

</details>

## Where to look

- `db/migrations/0042_payment_customer_nullable.sql`: changes a constraint on a live table
- `src/payments/list.ts:filterUnidentified`: new query path

## Not in this PR

- Refunds on this screen

## Follow-ups

Filled at finish.

---

Spec approved 2026-10-14 · [agreed decisions](https://github.com/acme/app/issues/2510#issuecomment-1)
```

- First line: the forge's or tracker's closing reference for a ticket run (`Closes #<n>`, `Closes PROJ-12`), then what
  the feature does in one sentence.
- What changed: two to four bullets on behavior and why, never a file-by-file restatement of the diff.
- Scenarios: collapsed in `<details>`, its summary counting them; each `@S<n>`, its Then, and the journey test that
  proves it, or `QA` for an `uncovered` one. Keep the blank lines around the table so it renders.
- Where to look: one to three `file:symbol` entry points, each with what makes it risky.
- Not in this PR: the spec's out-of-scope items, so nobody flags them as missing.
- Footer: the approval date from `progress.md`, and a link to the gate's ticket comment: the URL logged in
  `progress.md`, else the ticket comment whose first line starts with `👨‍💻📝`. No comment → the date alone.
- Leave out prose paragraphs, command output, your reasoning, dropped findings and emojis.

**Finish (step 9).**

1. Read `plan.md`'s `## Setup` and the `## Configuration` section of each README the diff touched. Anything beyond
   `None.` goes under `## Setup required`, placed just before `## Follow-ups`, naming where it came from. Nothing → no
   section.
2. Replace `Filled at finish.` under `## Follow-ups` with each `deferred` finding and open `minor` (including
   `Tech debt:` ones) and each `waived` QA scenario, one line each with its id and why it was left. Write `None.` when
   there are none. This is where the merger sees what's left. Link the QA comment from the `QA` rows of the scenarios
   table.
3. Replace sections in place when editing the body; never add a second one. Mark the PR ready for review.
4. The finish card, for the user to understand what was built before merging:
   - **What it does now**: the behavior each scenario added, in plain words, one line each.
   - **Try it**: the `dev` command from the `- tools:` line and the steps that walk each scenario's When, reusing the
     verifier's steps from `qa.md` when QA ran.
   - **Code tour**: three to five `file:symbol` entries in the order a request flows through them, each with its part.
   - **Deviations**: every `decisions:` entry from the coder's replies in `briefs/`, or `None.`
   - The PR link, the QA comment link if any, scenarios passing, review rounds and attempts used, the setup lines, and
     the follow-ups again, each as a ticket title and body ready to paste. You don't file them.
5. Handoff, for a ticket that belongs to a roadmap epic: take the first feature in the epic's list that is still open
   and isn't this one. If the tickets it's blocked by are all closed, say it's ready; otherwise say this PR has to merge
   first. Print the line to run next: `/solodev-mission <ticket>`.
