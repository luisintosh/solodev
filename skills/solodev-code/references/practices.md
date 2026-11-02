# Practices

What you leave comes back as a fix round. The reviewers read these same lists, one lens each.

## Contract

- **Scenarios hold:** each changed path does what its scenario's Given/When/Then says, not only its test going green.
- **Coverage, both ways:** every changed code path maps to a scenario, and every scenario is asserted by its journey
  test through the public boundary, not by a unit test of an internal helper. The second direction is the one that ships
  untested.

## Correctness

- **Bugs:** no inverted condition, off-by-one, unhandled empty or missing input, or error branch that returns success,
  under inputs the feature will really see.
- **Silent failure:** errors propagate. No swallowed exception, empty catch, default that masks a failed call, or throw
  turned into a logged warning. The quickest way to make a failing test pass is to stop propagating its error.
- **Blast radius:** a changed shared symbol, signature, default or export has every caller found and updated.

## Security

- **Access:** authorization on every newly reachable path, checked on the server side, for the resource asked for and
  not only for the user.
- **Input:** validation where input crosses a trust boundary; no input reaches a query, shell, path or template
  unescaped.
- **Secrets:** no secrets or tokens in code, logs, error messages or test fixtures.
- **Data:** a delete or overwrite can't hit more rows than the user meant, and a migration runs safely on existing data
  and states how it is undone.

## Tests

- **Test quality:** tests assert behavior, not implementation; none passes only because a mock was called or relies on
  another test's order or leftovers. Any test skipped, deleted or loosened to get green is a `major` whose text starts
  `Weakened test:`; the user decides it.
- **Config documented:** a variable or setting the change starts reading is named in a README, a `docs/` page or the env
  template.

## Design

Follow the repo's existing idiom first (`docs/ARCHITECTURE.md` when present, neighbouring modules). One occurrence is
code, two is a coincidence, the third is a pattern; flag or fix a smell only where it is in code this change writes or
touches.

- **Duplication:** the same branch on a kind at two or more sites, the same sequence of three or more calls, the same
  retry, cache, auth or timing wrapper.
- **Misplaced rules:** a rule on a primitive validated in several places, a service that reads an object's fields,
  decides and writes them back, queries inside domain rules or handlers, domain code importing a framework or SDK, an
  SDK or ORM type leaking past the module that calls it.
- **Loose state:** a status or flag combination checked across functions with ad hoc transitions, new module-level
  mutable state.
- **Over-engineering:** an interface, factory or strategy map with one implementation, a pass-through layer that adds no
  rule, an event with a single subscriber that must run in line. Inline it.
- **Docs, minimal:** a new module's entry file opens with one or two lines on what it owns. Each new or changed export
  gets a one-line doc comment in the repo's idiom saying what it's for, plus a line only for what the signature can't
  show: errors, side effects, units, or why it exists. A constraint that would cost someone an hour gets one line where
  it applies. No comment restating a name or type, none on obvious private code, no parameter lists that repeat the
  signature.
- **Residue:** no comments narrating the change ("changed from X per review"), no commented-out old code, no debug
  output.

A finding, or your own fix, names the smell and a concrete change in this repo's terms.

## UI

For a change to anything the user sees: components, templates, styles, copy, screens.

- **Accessible:** semantic elements, a label on every control, reachable by keyboard with visible focus, and nothing
  told by color alone.
- **States:** every new async or data-driven view has its loading, empty, error and disabled states.
- **Consistent:** the repo's existing components and design tokens (and `DESIGN.md` when present) over one-off styles.
- **Layout:** no fixed size that breaks a narrow screen, no text that overflows its box.
- **Copy:** an error tells the user what to do next, wording matches the spec, and strings go through the repo's i18n
  when it has one.
