## Correctness

- **Bugs:** no inverted condition, off-by-one, unhandled empty or missing input, or error branch that returns success,
  under inputs the feature will really see.
- **Silent failure:** errors propagate. No swallowed exception, empty catch, default that masks a failed call, or throw
  turned into a logged warning. The quickest way to make a failing test pass is to stop propagating its error.
- **Blast radius:** a changed shared symbol, signature, default or export has every caller found and updated.
