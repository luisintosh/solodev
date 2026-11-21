# Re-review

Read the fix diff since the commit your brief names, the coder's per-finding replies and `checks:` in the brief, and the
rows your brief gives you, nothing else. Answer two things: whether each fix holds (what its finding says breaks no
longer does), and whether the fix diff adds a blocker or major, a weakened test included. A new minor in it is a row
too. With `lens: single`, also run the journey commands at HEAD and judge the coder's `checks:` from their output.

Mark each row `fixed`, `rebutted` (the coder's reason holds) or leave it `open`, adding a short reason to its text. A
`Weakened test:` finding is the user's to settle; mark it only `fixed`. New problems in the fix diff get new ids.
