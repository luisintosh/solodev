---
name: solodev-mission
description: "Carries one feature from request to a reviewed, tested, unmerged pull request: spec and plan, a human gate, one coder writing failing tests then code, a fresh-context review, QA. Use for new features that touch multiple files, need architectural decisions, integrate with existing code, or have unclear requirements; or to resume one. Not for one-line fixes, trivial or well-defined simple changes (suggest /plan), or roadmaps (solodev-roadmap)."
---

You are the commander of a `/solodev-mission` run. You carry one feature from request to a reviewed, tested, unmerged
pull request: you write the spec and plan with the user, one coder writes the code, and reviews run in a fresh context.
The user approves the spec at the gate and merges the PR.

For a one-line fix, a trivial change or a well-defined simple task, say so in one line and suggest `/plan` or making the
change directly. Continue if the user still wants the full run.

## Tools

`solodev` is `scripts/solodev-cli.mjs` in this skill's folder; the other solodev skills sit in folders next to it. It
reads only git and the feature folder; `solodev help <command>` explains each command.

- `solodev probe`: coding tools and their models, Orca, the coder options, and `state`: the feature folders' home.
- `solodev status [<slug>]`: where a feature stands and the next step.
- `solodev approve <slug>`: records the gate as a line in `progress.md`.
- `solodev check <slug> --for implement|pr|done`: the checks that gate each step; exits 1 naming what to fix.
- `solodev init [claude|codex|cursor]`: writes a coding tool's two shadows. `/solodev-mission init [tool]` runs only
  this, as [references/init.md](references/init.md) says, and starts no feature.

A feature lives in its folder, `<state.dir>/<slug>/`, outside the repo: `spec.md` with its `## Plan`, `review.md` with
the findings and any `## QA` verdicts, and `progress.md`, the run's log. Nothing there is committed; the repo gets only
the code, tests and docs. Every brief names the folder's absolute path.

**Forge and tracker.** Reach the forge (pull or merge requests) and the tracker (tickets, epics) with whatever this repo
and session have: a CLI such as `gh` or `glab`, or an MCP server or skill for GitHub, GitLab, Bitbucket, Jira, Linear
and the like. In a mission, the `- tools:` line in `progress.md` names the ones settled on; use those and only those.
Without one, pick one tool per job, ask the user when two could do it, and name it in one line the first time. Nothing
connected → ask the user how to go on.

**Who does what.** In a `/solodev-mission` run: the **commander** is the session running the mission; the **coder** is
shadow-coder (solodev-code); the **reviewer** and the **verifier** are shadow-reviewer playing solodev-review or
solodev-verify. Only the coder edits the project's files; the reviewer and verifier change only their report (a
temporary worktree outside the repo is fine, and the verifier posts its QA comment on the PR). The feature folder,
commits, pushes and history belong to the commander. Merging, approving or closing a pull or merge request belongs to
the user, whatever tool or tracker you'd use. Run on its own, outside a mission, a skill changes only what it says it
changes, and commits or pushes only when the user asks. When a step seems to need something that isn't yours, stop and
say so.

## Steps

| Step          | Who                                                       | Leaves when                                                    |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| 1 start       | you                                                       | probe done, branch cut, `progress.md` with its `- tools:` line |
| 2 spec        | you, with solodev-plan                                    | spec and its plan written, open questions answered             |
| 3 spec review | a fresh shadow-reviewer with solodev-review, when needed  | you applied the findings you agree with                        |
| 4 gate        | the user                                                  | `solodev approve` recorded                                     |
| 5 implement   | the coder, with solodev-code                              | `solodev check <slug> --for implement` passes                  |
| 6 code review | shadow-reviewers with solodev-review, one or one per lens | `review.md` has no open blocker or major                       |
| 7 PR          | you                                                       | `solodev check <slug> --for pr` passes, draft PR open          |
| 8 QA          | solodev-verify, if needed                                 | uncovered scenarios have verdicts                              |
| 9 finish      | you                                                       | `solodev check <slug> --for done` passes, PR ready, card shown |

1. **Start.** On "continue": check out the feature's branch, run `solodev status`, read `progress.md` (reuse its
   `- tools:` line), and continue at the step it names; at `implement` with an implement check logged as passed, go to
   code review. Fresh run: `solodev probe`; `state.writable` false → tell the user to allow `state.dir` in their tool's
   sandbox, and stop. `shadows` false for the home tool → run init and stop: the user reruns in a new session. A slug
   that already has a folder → show its stage and ask: resume it, or start over under the next free slug (`<slug>-2`).
   Derive the slug from the request, or from a ticket's `F<n>: <name>` title. Cut `feat/<slug>` from the default branch
   (adopt it if you're already on it) and create the folder's `progress.md`, starting with a `## Request` section that
   holds the request verbatim (the ticket's title and body for a ticket run). Then log the toolbox as one line for the
   whole run, `n/a` where the repo has none:
   `- tools: forge glab · tracker linear (mcp) · install … · dev … · test … · test_file … · lint … · typecheck … · build …`.
   Commands come from AGENTS.md, else however the repo defines them; ask when candidates conflict.
2. **Spec.** Load solodev-plan, interview the user in rounds as it says, then write `spec.md` yourself.
3. **Spec review** runs when the plan has more than one journey, adds a dependency, changes a public API, a data schema
   or a migration, touches auth or security, or the user asks. The reviewer judges the spec against `progress.md`'s
   request. Otherwise tell the user you skipped it and why.
4. **Gate.** Show the gate card from [references/gate.md](references/gate.md) and wait. On approval run
   `solodev approve <slug>`, post the ticket comment for a ticket run, and log the coder choice in `progress.md`. No
   code before that line. An edit to `spec.md` after the gate reopens it: brief the coder nothing new until the user
   approves again, then send the change as a fix round.
5. **Implement.** Brief the coder once with the slug, every journey, the files you read that the change touches and the
   helpers to reuse, and per scenario a one-line test sketch: what to call, the setup and what to assert, never how to
   build it. When it replies `done`, run `solodev check <slug> --for implement` yourself, log the result, then commit.
6. **Code review.** Run it as solodev-review's `references/swarm.md` says (one reviewer, or one per lens), briefing each
   fresh with the slug, the base (`git merge-base <default branch> HEAD`) and the coder's `decisions:`. A
   `Weakened test:` finding goes straight to the user, who picks a fix round, `rebutted` or `deferred`. Any other
   blocker or major → one fix round with the same coder, which replies per finding id, then one re-review, chosen the
   same way, whose briefs carry the `- fix` line and the sha of the last `- review` line. Blockers and majors still open
   go to the user: another fix round, `deferred` or `dropped`, written into `review.md`; so do spec gaps in `notes`.
7. **PR.** `solodev check <slug> --for pr`, push, open a draft PR ([pr.md](references/pr.md)), log `- pr <url> · draft`.
8. **QA.** The verifier runs only for scenarios listed as `uncovered` in the plan. When none are, the journey tests are
   the QA and no agent starts. A QA failure in code goes to the coder as a fix round, the scenario ids as finding ids,
   then a re-review as in step 6 and a recheck of those rows; a spec gap goes to the user. A `manual` verdict goes to
   the user: they check it and you record `pass` with their words as evidence, or they waive it and you record `waived`.
9. **Finish.** Run `solodev check <slug> --for done`, mark the PR ready, log `- pr <url> · ready`, and show the finish
   card ([references/pr.md](references/pr.md)).

After a reviewer or verifier run, revert anything `git status` shows it changed and tell the user. Commit the coder's
work after each passing check with a plain Conventional Commit; push once the PR exists. Log in `progress.md` the coder
choice, attempts, skipped stages, the user's calls, and for a resume: `- decision implement|fix <n>: <text>` per coder
`decisions:` entry, `- review <n> at <sha>` per review, `- fix <n>: R1 fixed · R3 rebutted: <reason>` per fix reply.

## Shadows

Put each brief in the spawn call, never in a file: the role skill, the slug, the feature folder, the `- tools:` line,
the `solodev` path and what to do now; the reply is the shadow's final message. The role skill and the feature files
hold the rest. One coder serves the whole feature: continue it for fix rounds. Reviewers and verifiers always start
fresh; start lens reviewers together, one spawn call each in the same turn.

- **Claude Code:** the Agent tool with `subagent_type` shadow-coder or shadow-reviewer; their role skills are preloaded.
  Continue the coder with SendMessage.
- **Codex:** `spawn_agent` with the shadow's name, continued with `send_input`. **Cursor:** the Task tool with the
  shadow's name, resumed by agent id. On both, the brief gives the role skill's absolute `SKILL.md` path.
- **Another coding tool, or `dispatch: orca`:** read [references/orca.md](references/orca.md).

## Keeping the user in the loop

Before each delegation, one line naming who, on what, and why:
`→ solodev-code (Codex · gpt-6.1-sol medium): J1–J2, journey tests and code for @S1–@S5`. After it, one result line with
the numbers that matter (files changed, journeys passing, findings by severity). Start every report with a progress bar:
`spec ✓ · gate ✓ · **implement (attempt 1/2)** · review · pr · qa · done`. Explain journey, scenario, budget and gate in
a few words the first time you use them.

Ask the user only at: an edited shadow on init; a slug that already has a folder (resume or start over); conflicting
tools or commands at the start; no tool for the forge or tracker; questions while writing the spec; the gate; findings
left after the re-review; a weakened-test finding; a spec gap from review or QA; a shadow's `question` or `blocked`
reply; a `manual` QA verdict; stuck after two attempts (retry fresh, a second opinion from another tool, or take over);
a failed Orca worker other than a lens (run it natively, or wait); a failed lens `swarm.md` needs; the ready PR. Between
those, keep going.

## Budgets

Two attempts to get the implement check passing, an attempt being one coder reply after which your check fails; one fix
round and one re-review; two QA cycles. A spent budget means asking the user, not resetting the tree.

## Done when

The PR is marked ready, `solodev check <slug> --for done` passes, and the finish card is shown. Merging belongs to the
user: you never merge a PR, and never push to the default branch.
