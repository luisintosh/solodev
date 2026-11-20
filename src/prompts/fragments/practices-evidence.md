## Tests

- **Test quality:** tests assert behavior, not implementation; none passes only because a mock was called or relies on
  another test's order or leftovers. A test skipped, focused or deleted, or an assertion removed or loosened, is a
  `major` whose text starts `Weakened test:`; the user decides it.
- **Config documented:** a variable or setting the change starts reading is named in a README, a `docs/` page or the env
  template; one that isn't is a `major`.
