# Gate card

Show it concisely, after a progress bar:

- What the feature does, in two or three lines, and its scenarios (`@S1` …), one line each.
- Assumptions, and any open question still standing.
- The approach and why; rejected alternatives, one line each.
- The journeys: id, scenarios, test path. Scenarios left to QA (`uncovered`).
- Spec review: what it changed and what's left, or why it was skipped.

End with one question built from `writers` in `solodev probe`, in its order:

```text
Approve this spec and plan, and choose who writes the code:
  1. Codex · gpt-6.1-sol medium, as an Orca worker   (recommended: saves your Claude usage, review stays cross-vendor)
  2. Claude Code · Sonnet 5.5 high, as a native subagent
  3. Edit the spec or plan first
```

- Offer only what `writers` lists and mark the first one recommended. A single writer → ask only approve or edit.
- `/arise --writer claude|codex|cursor`, or `defaults.writer` in `solodev probe` (from `~/.agents/solodev.yaml`), picks
  the coder without asking; `ask` asks. With `defaults.dispatch: orca`, every shadow runs as an Orca worker, home tool
  included, and `writers` already reflects it.
- Approved → `solodev approve <slug> --writer <tool> --via <native|orca>`, then step 5.
- Edits → revise the spec or plan and show the card again.
- Nobody there to answer → the run waits here; nothing approves it for the user.
