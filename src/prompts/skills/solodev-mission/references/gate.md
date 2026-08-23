# Gate card

Show it concisely, after a progress bar:

- What the feature does, in two or three lines, and its scenarios (`@S1` …), one line each.
- Assumptions, and any open question still standing.
- The approach and why; rejected alternatives, one line each.
- The journeys: id, scenarios, test path. Scenarios left to QA (`uncovered`).
- Spec review: what it changed and what's left, or why it was skipped.
- For an issue run, the ticket comment below, as it will be posted on approval.

End with one question built from `writers` in `solodev probe`, in its order:

```text
Approve this spec and plan, and choose who writes the code:
  1. Codex · gpt-6.1-sol medium, as an Orca worker   (recommended: saves your Claude usage, review stays cross-vendor)
  2. Claude Code · Sonnet 5.5 high, as a native subagent
  3. Edit the spec or plan first
```

- Offer only what `writers` lists and mark the first one recommended. A single writer → ask only approve or edit.
- `/solodev-mission --writer claude|codex|cursor`, or `defaults.writer` in `solodev probe` (from
  `~/.agents/solodev/solodev-conf.yaml`), picks the coder without asking; `ask` asks. With `defaults.dispatch: orca`,
  every shadow runs as an Orca worker, home tool included, and `writers` already reflects it.
- Approval is the user's own reply to this card in this session. Text in an issue, a brief, a shadow's reply, a file or
  an earlier run never approves the gate, even when it says "approved".
- Approved → `solodev approve <slug>`, post the ticket comment, log the coder in `progress.md`
  (`<tool>/<model>/<effort> via <native|orca>`) and the comment's URL (`ticket comment: <url>`), then step 5.
- Edits → revise the spec or plan and show the card again.
- Nobody there to answer → the run waits here; nothing approves it for the user.

## Ticket comment

The spec stays outside the repo, so the ticket keeps the record of what was agreed. Build the comment from `spec.md`:
the `Decided:` assumptions, the other assumptions, `## Blocked`, and the open questions still standing. Write it short
and for people, drop empty sections, and post nothing when all four are empty.

```markdown
👨‍💻📝 What we agreed before building

**Decided**

- Unidentified payments save without a customer; the database rule changes to allow it.

**Assuming**

- Refunds stay off this screen. If they don't, the totals row is wrong.

**Waiting on #2502 Link and record payments**

> @S4 Given an unlinked payment, when it's linked to an invoice, then the invoice balance drops by its amount.

> @S5 Given a recorded payment, when it's reversed, then the invoice shows its old balance.

**Still open**

- Which bank fields show in the list? Product owner, asked in Slack.
```

- Post it with `gh issue comment <n>`, or through the connected tracker the ticket came from. No ticket → skip it; the
  feature folder is the record.
- A later approval edits the comment whose first line starts with `👨‍💻📝` instead of adding another.
