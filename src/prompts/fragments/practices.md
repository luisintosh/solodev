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
  another test's order or leftovers. Any existing test skipped, deleted or loosened to get green is a `blocker`.
- **Docs, minimal:** a new module's entry file opens with one or two lines on what it owns. Each new or changed export
  gets a one-line doc comment in the repo's idiom saying what it's for, plus a line only for what the signature can't
  show: errors, side effects, units, or why it exists. A constraint that would cost someone an hour gets one line where
  it applies. No comment restating a name or type, none on obvious private code, no parameter lists that repeat the
  signature.
- **Residue:** no comments narrating the change ("changed from X per review"), no commented-out old code, no debug
  output.

## Structure

Follow the repo's existing idiom first (`docs/ARCHITECTURE.md`, neighbouring modules). One occurrence is code, two is a
coincidence, the third is a pattern; apply a pattern only where its trigger is in code this change writes or touches.

- **Duplicated logic:** the same branch on a kind at two or more sites (a factory or a `kind → handler` map), the same
  sequence of three or more calls (one function), the same wrapper for retry, cache, auth or timing (one decorator), an
  SDK or ORM type leaking past the module that calls it (an adapter owned by the caller).
- **Domain rules:** a primitive carrying a rule validated in several places (a value object); a service that reads an
  object's fields, decides and writes them back (move the rule onto the object); persistence queries inside domain rules
  or handlers (a repository); domain code importing a framework or SDK (invert the dependency).
- **State:** a status field or flag combination checked across functions with ad hoc transitions (one transition
  function that rejects illegal moves); new module-level mutable state (construct it once and pass it in).
- **Over-engineering is a smell too:** an interface, factory or strategy map with one implementation, a pass-through
  layer that adds no rule, an event with a single subscriber that must run in line. Inline it.
