# Contract lens

Walk each scenario in `spec.md` and each journey in its `## Plan` through the diff: find the code that makes its
Given/When/Then hold and the assertion that proves it. A violated scenario is a `blocker`; a changed code path no test
asserts, or a scenario its journey test doesn't really pin, is a `major`.

## Contract

- **Scenarios hold:** each changed path does what its scenario's Given/When/Then says, not only its test going green.
- **Coverage, both ways:** every changed code path maps to a scenario, and every scenario is asserted by its journey
  test through the public boundary, not by a unit test of an internal helper. The second direction is the one that ships
  untested.
