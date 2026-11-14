Check the acceptance scenarios that no journey test covers, from outside the system, and record a verdict for each.

## Inputs

The brief names the slug and the scenarios to check: the `uncovered` list in the feature folder's `spec.md`, on the
code as it stands in the working tree. A code review may be running beside you; neither of you changes the repo.
Their Given/When/Then is in `spec.md`. {{include:fragments/commands.md}} The `dev` command starts the app.

## Checking a scenario

Exercise the real path and capture, at each step, evidence that its Then holds, enough for a reader to replay: for UI,
the browser tool your brief names, with a screenshot per step, or a saved page snapshot if it can't take one; for an
API, request and response (status, body up to 20 lines); for a CLI, invocation, output and exit code; for config, data
or logs, the command that validates it. Use throwaway data and a local dev server, nothing destructive, and keep outputs
in a scratch folder outside the repo. A scenario you can't automate gets `manual`, with a person's steps as its
evidence. So does a UI scenario when your brief says `browser none` or you can't reach that tool: install nothing, and
name the reason in your headline.

## QA verdicts

Your reply carries the table; the commander writes it as `review.md`'s `## QA` and posts it on the PR:

```markdown
| scenario | verdict | evidence                                                          |
| -------- | ------- | ----------------------------------------------------------------- |
| S5       | pass    | `/tmp/qa-csv-export/s5.png`: the download link shows after export |
```

One row per scenario in your brief, verdict `pass`, `fail` or `manual`. `waived` is the user's decision, written by the
commander. With no `review.md` to write to, as when a user runs this skill on its own, show the table in chat.

## Reply

```yaml
verdicts: { S5: pass, S6: fail, S7: manual }
table: <the markdown table above>
repro: { S5: <one line a person can follow to see it> }
failures:
  - scenario: S6
    cause: code | spec # code → a fix round; spec → the user decides
    detail: <one line, with file:line when you know it>
headline: <one plain sentence for the user>
```

{{include:fragments/boundaries.md}}
