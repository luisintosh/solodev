![Solodev](assets/header.jpg)

# Solodev

**Ship features with an AI team, not a single agent.** Describe a feature, approve one spec, and get back a reviewed,
tested, documented pull request, on [Claude Code](https://code.claude.com), [Codex](https://developers.openai.com/codex)
or [Cursor](https://cursor.com).

[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-d97757)](https://code.claude.com)
[![Codex](https://img.shields.io/badge/Codex-supported-10a37f)](https://developers.openai.com/codex)
[![Cursor](https://img.shields.io/badge/Cursor-supported-111111)](https://cursor.com)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue)](LICENSE)

```bash
npx skills add luisintosh/solodev          # -g for every repo
```

Then, once in each coding tool: `/solodev-mission init`, start a new session, and:

```text
/solodev-mission Add CSV export to the accounts page
```

> I built solodev for my own work; it's the workflow I use every day to ship features with AI agents. —
> [Luis Mendieta](https://github.com/luisintosh)

## Why

Ask one agent to "build feature X" and it guesses at the scope, writes tests that pass by construction, reviews its own
work, and loses the thread when its context fills up. solodev gives top models what they can't give themselves:

|                                               | One agent | Plan mode (`/plan`) | solodev                                       |
| --------------------------------------------- | --------- | ------------------- | --------------------------------------------- |
| Spec you approve before code                  | no        | a plan              | requirements + acceptance scenarios + plan    |
| Tests checked to fail first                   | no        | no                  | yes, by the reviewer, on the old and new code |
| Review by an agent that didn't write the code | no        | no                  | yes, fresh context, by lens                   |
| Machine-checked gates                         | no        | no                  | yes, the `solodev` CLI reads git              |
| Ends in                                       | a diff    | a diff              | a ready PR you merge                          |

## How it works

`/solodev-mission` is the commander. It writes the spec with you, then hands the work to two **shadows**, subagents with
their own models and fresh context: one coder and one reviewer.

1. **Spec.** Requirements, acceptance scenarios tagged `@S1`, `@S2`…, and a plan of at most three **journeys**: one test
   file each, proving a group of scenarios.
2. **Gate.** You approve the spec. No code exists before that, and `solodev check` fails a branch that has some.
3. **Implement.** The coder writes the journey tests, then the code and the docs beside it.
4. **Review.** A reviewer runs each journey test on the old code (it must fail) and the new (it must pass), and reads
   the diff through **lenses**: evidence, contract, correctness, security, design, UI. A sensitive change (auth,
   payments, migrations, a public API) gets one reviewer per lens, in parallel. Blockers go back to the coder once.
5. **PR.** A draft PR, QA for any scenario no test covers, then the PR is marked ready. You merge.

Every step has a budget (two implement attempts, one fix round, one re-review); a spent budget comes to you instead of
looping. With [Orca](https://github.com/stablyai/orca), the coder can run on another tool, so each PR is also reviewed
by a different model family.

| Skill                            | Role                                                                        |
| -------------------------------- | --------------------------------------------------------------------------- |
| `/solodev-mission`               | carries one feature from request to a ready PR                              |
| `/solodev-plan`                  | writes a spec on its own                                                    |
| `/solodev-review`                | reviews a spec or any branch                                                |
| `/solodev-roadmap`               | turns an idea into a goal, a data model and a roadmap filed in your tracker |
| `/solodev-scout`                 | maps a repo once into `AGENTS.md` and `docs/ARCHITECTURE.md`                |
| `solodev-code`, `solodev-verify` | the coder's and QA's roles, started by the commander                        |

## Models

| profile     | Claude Code                      | Codex              | Cursor                        |
| ----------- | -------------------------------- | ------------------ | ----------------------------- |
| `think`     | `claude-opus-5-5[effort=medium]` | `gpt-6-astra[max]` | `gemini-4-argon[effort=high]` |
| `implement` | `claude-sonnet-5-5[effort=high]` | `gpt-6.1-sol[max]` | `grok-4.7[effort=high]`       |

| shadow            | profile     |
| ----------------- | ----------- |
| `shadow-coder`    | `implement` |
| `shadow-reviewer` | `think`     |

Start your session on the `think` model; it plans and reviews, and the cheaper `implement` model writes the code.

## How it's built

```mermaid
flowchart LR
  src["catalog.yaml + prompts<br/>one source"] --> build["build"]
  build --> skills["7 skills<br/>npx skills add"]
  build --> cli["solodev CLI<br/>gates from git · init"]
  cli --> claude[".claude/agents"]
  cli --> codex[".codex/agents (TOML)"]
  cli --> cursor[".cursor/agents"]
  evals["prompt quiz + stage evals"] -.->|every prompt change| src
```

- **One source, three tools.** Roles are written once and compiled to each tool's native format, models pinned in one
  catalog.
- **Rules that code can check are code.** "No code before approval" or "every scenario is claimed by a test" are CLI
  checks over git, with unit tests; prompts keep only what needs judgment.
- **Prompts are tested like software.** A quiz of 60 decision scenarios and 38 routing queries runs on every prompt
  change (latest run: 60/60 scenarios, 37/38 routing). Stage evals run the real workflow headless, with real subagents,
  graded by scripts on what reached git. They caught, for example, that a tool loads subagents only at startup, so a run
  that installs them mid-session now stops for a restart.
- **Lean.** Each skill has a line budget enforced in CI, detail loads only when a step needs it, and a feature's stage
  is derived from git and its folder, with no state machine.

Source, evals and build: the [`develop`](https://github.com/luisintosh/solodev/tree/develop) branch.

## FAQ

**What lands in my repo?** Only the feature's code, tests and docs, plus the installed skills and subagents for a
project install. The spec and reports live in `~/.agents/solodev/<owner>/<repo>/<feature>/`; the PR carries the
scenarios.

**Do I need GitHub?** No. Any forge or tracker your tool can reach works (`gh`, `glab`, or an MCP server for GitLab,
Jira, Linear…); without one, it asks you.

**How do I resume?** Ask `/solodev-mission` to continue. Any session can, since state lives in git and the feature
folder.

**Can it merge or push to main?** No. It opens the PR and marks it ready; use branch protection as the backstop.

**Coming from the old installer (v5 and earlier)?** Install as above and let `/solodev-mission init` use `--force` once
per tool. Feature folders stay where they are.

**Requirements:** Node.js 20+, Git, and one coding tool you're logged in to. Optional:
[agent-browser](https://github.com/vercel-labs/agent-browser) for UI checks, [rtk](https://github.com/rtk-ai/rtk) for
quieter command output.

---

The name comes from _Solo Leveling_, where one hunter commands an army of shadows. Licensed under Apache 2.0.
