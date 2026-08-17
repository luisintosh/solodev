# Stage evals

Each stage tests one step of a skill. It starts from a prepared repo and feature folder instead of from scratch, caps
the agent's turns, and is graded by scripts that read git, the feature folder and the transcript. A stage costs a few
turns, not a full run. The full end-to-end run lives in [../outcome/](../outcome/README.md), for releases.

| Path                 | Holds                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| `<id>/stage.json`    | the prompt, the skill, its tier, the turn cap, the setup and the checks      |
| `<id>/seed/`         | files laid over the fixture before its first commit (optional)               |
| `<id>/feature/`      | the feature folder the stage starts with: spec, plan, progress (optional)    |
| `<id>/code/`         | files committed on the branch after the approval (optional)                  |
| `results/<id>.jsonl` | one line per run: checks passed, turns, wall time, cost, failed expectations |

Setup builds the fixture with `seed/`, installs solodev from `dist/`, runs `npm ci` when `npm` is set, cuts `branch`,
copies `feature/` to `<state>/<slug>/`, runs `solodev approve <slug>` when `approve` is set, then commits `code/`. When
`start` is set, `solodev status` has to report that stage, and `solodev check --for <check>` has to pass, before the
agent starts.

```bash
pnpm run eval:validate                  # no agents: every stage's starting point holds (also in CI)
pnpm run eval:smoke                     # unit tests, then the smoke tier
pnpm run eval:stage                     # every stage
pnpm run eval:changed                   # only the stages whose prompts changed since master
node tools/eval-stage.ts run --stage resume-review --judge --keep
```

`--judge` grades the `judge` expectations with one Haiku call per stage; without it they're skipped. `--keep` leaves the
workspace in place. Each run prints the transcript's path.

## Checks

Each check has an `expect` (what it proves, in words) and exactly one of these:

| Key        | Passes when                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `file`     | the path exists; with `matches`, the regex matches. `{feature}` and `{state}` expand             |
| `git`      | the git command prints lines (or lines matching `matches`); `{base}` is HEAD at the end of setup |
| `tool`     | the commander called a tool by that name, with `input` matching, before its first `before` call  |
| `reply`    | the commander's messages match the regex; `final` looks only at the last one                     |
| `status`   | `solodev status` reports one of the listed stages                                                |
| `features` | there are feature folders                                                                        |
| `judge`    | a model agrees, with `--judge`                                                                   |

`count: { min, max }` bounds the number of matches, calls or lines; without it a check needs at least one, and
`count: { max: 0 }` means none. Subagents' tool calls don't count as the commander's.

A stage's `covers` lists the skills and shadows whose prompts it exercises; `--changed` runs it when one of them
changed. A change to a fragment, the catalog, the CLI or this runner runs every stage.

Prefer a `file`, `git`, `tool` or `status` check to a `judge`, and a new stage that starts later to a longer one.
