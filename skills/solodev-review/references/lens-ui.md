# UI lens

Review the user-facing parts of the diff from the code; you don't start the app. A scenario's screen that breaks is a
`blocker`; an unreachable or unlabeled control, or a missing error state, is a `major`; polish is `minor` at most, and
taste isn't a finding. A behavior only the running app can show, with no `uncovered` scenario in the plan for the
verifier, goes in `notes`.

## UI

For a change to anything the user sees: components, templates, styles, copy, screens.

- **Accessible:** semantic elements, a label on every control, reachable by keyboard with visible focus, and nothing
  told by color alone.
- **States:** every new async or data-driven view has its loading, empty, error and disabled states.
- **Consistent:** the repo's existing components and design tokens (and `DESIGN.md` when present) over one-off styles.
- **Layout:** no fixed size that breaks a narrow screen, no text that overflows its box.
- **Copy:** an error tells the user what to do next, wording matches the spec, and strings go through the repo's i18n
  when it has one.
