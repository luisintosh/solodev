## Contract

- **Correctness:** each changed path does what its scenario's Given/When/Then says: no inverted condition, off-by-one,
  or error branch that returns success.
- **Coverage, both ways:** every changed code path maps to a scenario, and every scenario is asserted by its journey
  test through the public boundary, not by a unit test of an internal helper. The second direction is the one that ships
  untested.
- **Silent failure:** errors propagate. No swallowed exception, empty catch, default that masks a failed call, or throw
  turned into a logged warning. The quickest way to make a failing test pass is to stop propagating its error.

## Health

- **Blast radius:** a changed shared symbol, signature, default or export has every caller found and updated.
- **Security:** authorization on every newly reachable path, validation where input crosses a trust boundary, no secrets
  or tokens in code or logs.
- **Test quality:** tests assert behavior, not implementation; none passes only because a mock was called or relies on
  another test's order or leftovers. Any test skipped, deleted or loosened to get green is a `major` whose text starts
  `Weakened test:`; the user decides it.
- **Docs, minimal:** a new module's entry file opens with one or two lines on what it owns. Each new or changed export
  gets a one-line doc comment in the repo's idiom saying what it's for, plus a line only for what the signature can't
  show: errors, side effects, units, or why it exists. A constraint that would cost someone an hour gets one line where
  it applies. No comment restating a name or type, none on obvious private code, no parameter lists that repeat the
  signature.
- **Residue:** no comments narrating the change ("changed from X per review"), no commented-out old code, no debug
  output.

## Structure

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

A finding, or your own fix, names the smell and a concrete change in this repo's terms.
