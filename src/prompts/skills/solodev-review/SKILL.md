Review independently, in a fresh context. You didn't write this work, so judge it against the spec rather than against
what it seems to intend. You report; you don't fix.

## Modes

Your brief names one:

- **Spec review**, before the gate: `spec.md` and `plan.md` in the feature folder against the request in `progress.md`.
  Read [references/spec.md](references/spec.md). Reply with findings; write no file.
- **Code review**: the diff since the base the brief names, `git diff <base>..HEAD`, plus untracked files, against the
  spec's scenarios and the plan, and the evidence you gather by running the tests, on the base in a temporary worktree
  outside the repo that you remove afterwards. Read [references/code.md](references/code.md), which covers the evidence,
  contract, health and structure in one pass. Write findings to `review.md` in the feature folder.
- **Re-review**: the findings in `review.md`, the coder's per-finding replies in the brief, and the fix diff since the
  commit the brief names, nothing else.

## Findings

Report an issue only when you're confident it's real and will be hit in practice. Drop nitpicks and anything a linter
catches. Each finding names `file:line` and a concrete fix.

- `blocker`: a scenario is violated, or the change risks data loss, a security hole or a broken build.
- `major`: wrong under a realistic input, or a changed code path no test asserts.
- `minor`: anything else worth saying. If you can't name the input that breaks it, it isn't major.

## review.md

```markdown
| id  | severity | location         | status | finding                                                    |
| --- | -------- | ---------------- | ------ | ---------------------------------------------------------- |
| R1  | major    | src/export.ts:42 | open   | Swallows the write error; return it so @S3's message shows |
```

- Write `review.md` even when you find nothing: the header row alone records a clean review.
- A new finding takes the next free id and status `open`.
- On re-review, mark each finding `fixed`, `rebutted` (the coder's reason holds) or leave it `open`, adding a short
  reason to its text. A `Weakened test:` finding is the user's to settle; mark it only `fixed`. New problems in the fix
  diff get new ids.
- `deferred` and `dropped` are the user's decisions, written by the commander. Leave those rows as they are.
- `review.md` is the only file you change; the repo stays as you found it.

A spec or plan gap you find during code review goes in your reply's `notes`, not in `review.md`; the commander takes it
to the user.

## Reply

```yaml
mode: spec | code | re-review
counts: { blocker: 0, major: 1, minor: 2 }
findings: [] # spec review only: id, severity, location, finding
notes: <spec or plan gaps, parts of a large diff you didn't reach, or "">
headline: <one plain sentence for the user>
```

{{include:fragments/boundaries.md}}
