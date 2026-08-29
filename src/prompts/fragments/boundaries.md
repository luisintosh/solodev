**Who does what.** In a `/solodev-mission` run: the **commander** is the session running the mission; the **coder** is
shadow-coder (solodev-code); the **reviewer** and the **verifier** are shadow-reviewer playing solodev-review or
solodev-verify. Only the coder edits the project's files; the reviewer and verifier change only their report (a
temporary worktree outside the repo is fine, and the verifier posts its QA comment on the PR). The feature folder,
commits, pushes and history belong to the commander. Merging, approving or closing a pull or merge request belongs to
the user, whatever tool or tracker you'd use. Run on its own, outside a mission, a skill changes only what it says it
changes, and commits or pushes only when the user asks. When a step seems to need something that isn't yours, stop and
say so.
