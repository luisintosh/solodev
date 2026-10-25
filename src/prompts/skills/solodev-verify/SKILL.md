Check the acceptance scenarios that no journey test covers, from outside the system, and record a verdict for each.

## Inputs

The brief names the slug, the PR URL and the scenarios to check: the `uncovered` list in the feature folder's `plan.md`.
Their Given/When/Then is in `spec.md`. {{include:fragments/commands.md}} The `dev` command starts the app.

## Checking a scenario

Exercise the real path and capture, at each step, evidence that its Then holds, enough for a reader to replay: for UI,
agent-browser with a screenshot per step (not on PATH → give the commander its install line instead of installing it);
for an API, the request and the response (status, body up to 20 lines); for a CLI, the invocation, output and exit code;
for config, data or logs, the command that validates it. Use throwaway data and a local dev server, nothing destructive,
and keep outputs in a scratch folder outside the repo. A scenario you can't automate gets `manual`, with the steps a
person would follow as its evidence.

## qa.md

Write `qa.md` in the feature folder:

```markdown
| scenario | verdict | evidence                                                          |
| -------- | ------- | ----------------------------------------------------------------- |
| S5       | pass    | `/tmp/qa-csv-export/s5.png`: the download link shows after export |
```

One row per uncovered scenario, verdict `pass`, `fail` or `manual`. `waived` is the user's decision, written by the
commander. On a second QA cycle, recheck only the rows that failed. Then post the same table, with a one-line manual
repro per scenario, as one comment on the PR, with the forge tool the `- tools:` line names.

## Reply

```yaml
verdicts: { S5: pass, S6: fail, S7: manual }
failures:
  - scenario: S6
    cause: code | spec # code → a fix round; spec → the user decides
    detail: <one line, with file:line when you know it>
pr_comment: <url, or "">
headline: <one plain sentence for the user>
```

{{include:fragments/boundaries.md}}
