## UI

For a change to anything the user sees: components, templates, styles, copy, screens.

- **Accessible:** semantic elements, a label on every control, reachable by keyboard with visible focus, and nothing
  told by color alone.
- **States:** every new async or data-driven view has its loading, empty, error and disabled states.
- **Consistent:** the repo's existing components and design tokens (and `DESIGN.md` when present) over one-off styles.
- **Layout:** no fixed size that breaks a narrow screen, no text that overflows its box.
- **Copy:** an error tells the user what to do next, wording matches the spec, and strings go through the repo's i18n
  when it has one.
