## Correctness

- **Bugs:** no inverted condition, off-by-one, unhandled empty or missing input, or error branch that returns success,
  under inputs the feature will really see.
- **Silent failure:** errors propagate. No swallowed exception, empty catch, default that masks a failed call, or throw
  turned into a logged warning. The quickest way to make a failing test pass is to stop propagating its error.
- **Blast radius:** a changed shared symbol, signature, default or export has every caller found and updated.
- **Stale writes:** a write sends the version or id the client read when the user started, not one fetched since, and a
  target that changed in between is refused or handled as the spec says.
