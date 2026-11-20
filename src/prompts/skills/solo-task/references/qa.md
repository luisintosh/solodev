# QA

The verifier checks the scenarios the plan lists as `uncovered`, on the committed code, in the same turn as the code
review. Both only read, so one fix round can answer both.

- **Brief.** The slug, the feature folder, the scenarios, the `- tools:` line. When a scenario needs a browser, the
  brief carries the last `- browser` line from `progress.md`, as `browser <tool>` or `browser none`. No such line, a
  tool that's gone, or one the verifier couldn't reach → ask the user as `## Browser` says, leaving out a tool that
  failed, and log the answer.
- **Verdicts.** The verifier replies with its table and changes no file. Once the reviewers are done, write the table as
  the `## QA` section at the end of `review.md`, leaving the findings as they are; on a later cycle, update its rows in
  place.
- **A failure in code** joins step 6's fix round, the scenario id as its finding id. Beside each re-review, a fresh
  verifier rechecks the `uncovered` scenarios that failed and those the fix diff could change; none of either → no
  verifier. A spec gap goes to the user. Three cycles spent → the user.
- **PR comment (step 8).** Once the draft PR is open, post the table, its `repro` column included, as one comment.
- **A `manual` verdict (step 8)** goes to the user: they check it and you record `pass` with their words as evidence,
  they waive it and you record `waived`, or they install a browser tool and you log it and rerun those rows.

## Browser

Check which tools this session has to drive one: a built-in browser (Claude desktop's, Cursor's, Orca's), an MCP server
(Chrome DevTools) or a skill or CLI (agent-browser). One → name it on the card. Several → ask which. None → ask:
install agent-browser and its skill (`npm i -g agent-browser && agent-browser install`,
`npx skills add vercel-labs/agent-browser -g -y -a claude-code|codex|cursor`, naming the tool running you), or use steps
for a manual test. The user runs those, or you do if they ask; if that fails, ask again. Approved at the gate with the
browser unsettled or an install pending → log no `- browser` line and go on; step 6 asks before the verifier starts.
