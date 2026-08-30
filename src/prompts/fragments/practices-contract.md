## Contract

- **Scenarios hold:** each changed path does what its scenario's Given/When/Then says, not only its test going green.
- **Coverage, both ways:** every changed code path maps to a scenario, and every scenario is asserted by its journey
  test through the public boundary, not by a unit test of an internal helper. The second direction is the one that ships
  untested.
