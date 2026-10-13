# Outcome evals

Each task in `tasks/<id>/` is a feature request on a copy of `test/fixture-repo`, with **held-out acceptance tests**
written in advance (`heldout/`, plain `node:test`). They are copied in only after the agent finishes, so success is
never judged by the agent's own tests.

| Path                     | Holds                                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| `tasks/<id>/task.json`   | the request (`prompt`) and its `shape`                                 |
| `tasks/<id>/seed/`       | files added to the fixture before the run (optional)                   |
| `tasks/<id>/heldout/`    | the acceptance tests                                                   |
| `tasks/<id>/reference/`  | a solution, used only to prove the held-out tests can pass             |
| `configs.json`           | what to compare: v1 baseline, v2 on each tool, mixed coders, ablations |
| `results/<config>.jsonl` | one line per run                                                       |

```bash
node tools/eval.ts validate                            # no agents: held-out tests fail on the fixture, pass on the reference
node tools/eval.ts run --config v2-claude --repeat 3   # runs /solodev-mission headless per task, scores, appends results
node tools/eval.ts report                              # mean ± spread per config, and the release bar
```

`run` installs solodev into a throwaway repo (`local` from this checkout's `dist/`, or `ref:<tag>` through npx), runs
the home tool headless, pre-approves the gate in the prompt, and skips the PR (there is no remote).

**`run` executes agents unattended on your machine**, with your environment and credentials. Each tool is limited as far
as its CLI allows: Claude Code to an allowlist of edits and git, node and npm commands; Codex to its `workspace-write`
sandbox. Cursor's headless mode can only approve every command, so Cursor configs refuse to start unless you pass
`--allow-unsandboxed`; do that only inside a container or VM. Running the whole harness in one is the safer choice for
any tool. It records held-out passes, wall time, cost and tokens where the tool reports them, whether the gate was
recorded (the approval line, or an approval commit for releases before v3.1), and the diff size. Feature folders go in
the workspace's git-ignored `.solodev-state/` so every tool's sandbox can write them.

**Release bar:** every `v2-<tool>` config matches or beats the baseline's held-out pass rate, at lower cost and lower
wall time, over at least three runs per task. The ablation configs justify each cut on its own: spec review and the
verifier always on vs conditional, and a v1-style plan with waypoints vs the v2 plan.

The fixture has no UI, so a UI task isn't included yet.
