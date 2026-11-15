# A coder on another tool

Only when the writer isn't the home tool. Reviewers and the verifier stay native.

- Carrier: an installed skill or plugin that runs an agent of the writer's tool and returns its result; without one, the
  writer's own CLI, headless. Name it on the gate card and log it as `via <carrier>`.
- Launch: in the current worktree and branch, in the background, able to edit the repo, run its commands and write the
  feature folder (`solodev proof` does). Model and effort from the writer's `launch` in `solodev probe` where the
  carrier takes them; otherwise say what it ran with.
- Brief: starts "Use the `solo-code` skill at <absolute SKILL.md path>" and ends "Write your reply to <reply path>": a
  new file each round, in a temp folder outside the repo and the feature folder. It's done when its process ends.
- One coder for the whole feature: answers and fix rounds go to the same session when the carrier can resume it,
  otherwise to a new one with the earlier brief and reply.
- Answer its questions from `spec.md`; ask the user when they can't.
- If it can't start, stalls or ends without a reply, ask the user: write on the home tool, or wait.
