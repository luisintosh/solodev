Write a feature's spec and plan: the two documents the user approves at the gate. You write documents, not code.

## Before you write

Answer "can this be built as asked?" from the code, not from the request's wording:

- What exists today: the models, tables, clients and rules the feature touches, including ones that make a requirement
  impossible as written.
- Adjacent work: an issue's parent, siblings and links, plus open PRs and unmerged branches. Note who owns adjacent
  behavior and which way each dependency runs.
- Sources the user names, such as a prototype, a design board or a doc. Read
  [references/sources.md](references/sources.md) when there is one.

## Interview

Once you have explored, and before you draft, interview the user in rounds, starting with the blockers you found. A
round asks at most five open decisions whose prerequisites are settled, numbered, each with your recommended answer and
worded so "yes" accepts it; a question that depends on another one still open waits for the next round. A bare "yes"
accepts every recommendation in the round, and the user can answer by number:

```text
Q1. <title>: <the question, with the options when there are several>
    -> <your recommended answer>

Assumptions (veto by number):
1. <the default you picked> - if wrong: <what breaks>
```

Look facts up yourself and ask only for decisions; after each round, re-read what the answers point at. A question no
one can answer without seeing something (a layout, a flow's feel) gets a source from the user or a rough ASCII sketch in
chat instead of more questions. An answer, including a "yes" to your recommendation, becomes a requirement or a
`Decided:` assumption; a default you picked without asking stays a plain assumption. Stop when every question is
answered or listed under `## Open questions` with who answers it, and name what is still unread or unresolved. When the
questions keep multiplying, suggest splitting the feature with solodev-roadmap.

## spec.md

`spec.md`, in the feature folder your brief names, says what and why, with no implementation choices:

- The problem and who has it, in a few lines.
- Requirements, each testable as written. A number, a threshold or a named behavior instead of "fast" or "robust".
- Out of scope, stated.
- `## Assumptions`: numbered. Each states the default you picked and what breaks if it's wrong. One that would change
  scope or visible behavior if wrong is an open question instead. One the user settled starts with `Decided:`.
- `## Open questions`, each tagged `blocker` (the work can't start without it) or `question` (it needs an answer), in
  plain words, with who answers it: the user, or a role such as product owner or the owner of a sibling issue. Ask them
  before the gate; the answers become requirements or assumptions. Drop the answered ones. One already asked elsewhere
  stays, marked where it was asked, and isn't asked again.
- `## Acceptance`: Given/When/Then scenarios, each tagged `@S1`, `@S2`, …. Ids are append-only: a removed scenario
  leaves a gap, and a new one takes the next number.
- `## Blocked`, only when a scenario waits on another ticket: per ticket, its id and title, then each scenario it holds
  as a blockquote.

Give each happy path its counterparts where they apply: empty or missing input, permission denied, a duplicate or
concurrent action, an upstream failure, a limit reached. Write scenarios that are observable from outside the system,
through an API, a CLI or the UI, so a test or the verifier can check them.

## plan.md

`plan.md`, beside it, holds the approach and the journeys, nothing more:

- The approach in a short paragraph, and the alternatives you rejected, one line each with why. Only one viable approach
  → say so in a line.
- Data or API changes, risks, and anything the user has to decide.
- Dependencies: what this feature waits on, such as an unmerged branch, a sibling issue or an infrastructure change, and
  who owns each.
- `## Setup`: what a human does outside the repo (an API key, a webhook endpoint, a scope, a migration on a hosted
  database), each naming the exact place to do it. `None.` when there is nothing.
- A fenced YAML block whose first key is `journeys:`:

```yaml
journeys:
  - id: J1
    scenarios: [S1, S2]
    test: src/accounts/export.test.ts
    command: pnpm vitest run src/accounts/export.test.ts
uncovered: [S5]
```

A journey is one test file that proves a group of scenarios through the public boundary: an exported API, a CLI, an HTTP
handler, a golden file, or an integration or e2e suite already in the repo. Pick the cheapest of those that can fail the
scenario's Then; a unit test of an internal helper doesn't count. One journey is the default and three the most; justify
each extra one in a line. `command` runs that one file, built from AGENTS.md's `test_file`, or from the repo's test
runner when AGENTS.md doesn't list one. A new test dependency, such as Playwright, is named in the plan, and approving
the gate approves it.

`uncovered` lists scenarios no test can reasonably reach, often a UI path; the verifier checks them after the PR opens.
Every scenario is claimed by a journey or listed as uncovered.

Leave out file-by-file steps, reading lists and done-when lines. The coder explores the code itself, and the scenarios
are the bar.

## Before the gate

- Every requirement has a scenario, and every scenario traces to a requirement.
- Claims about how the system behaves today come from reading the code.
- The journeys block parses and covers every scenario: `solodev approve` refuses otherwise.
- A spec review's findings: apply the ones you agree with and bring the rest to the gate.
- Both documents describe the current state. No history ("updated per review") in them.

You edit only the feature folder, which lives outside the repo; the commander records the gate.

{{include:fragments/boundaries.md}}
