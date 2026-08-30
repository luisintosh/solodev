# UI lens

Review the user-facing parts of the diff from the code; you don't start the app. A scenario's screen that breaks is a
`blocker`; an unreachable or unlabeled control, or a missing error state, is a `major`; polish is `minor` at most, and
taste isn't a finding. A behavior only the running app can show, with no `uncovered` scenario in `plan.md` for the
verifier, goes in `notes`.

{{include:fragments/practices-ui.md}}
