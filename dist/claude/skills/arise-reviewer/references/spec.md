# Spec review checklist

Check the spec against the request, then the plan against the spec.

**Spec**

- Requirements are testable as written; an adjective with no number or named behavior is a finding.
- Each happy path has its counterparts: empty or missing input, permission denied, duplicate or concurrent actions, an
  upstream failure, a limit reached. Specs with only happy paths are the most common failure.
- Claims about how the system behaves today hold up; check the load-bearing ones in the code.
- Every requirement traces to a scenario and back. Scenario ids are unique; a gap left by a removed scenario is fine.
- Assumptions state a default and what breaks if it's wrong; one that would change scope belongs in open questions.
- Out of scope is stated, and no implementation choices leak into the spec.

**Plan**

- The journeys block parses, and every scenario is claimed by a journey or listed as `uncovered`. Check that direction
  explicitly: the orphans are usually the error and edge cases.
- Each journey tests through the public boundary with the cheapest test that can fail its Then. A unit test of an
  internal helper as the acceptance bar is a blocker; so is an e2e test where a cheaper one could assert the Then.
- Each command runs with the repo's own runner (AGENTS.md); a wrong runner or path is a blocker.
- More than one journey has a one-line reason; more than three is a finding. A new test dependency is named.
- The approach reuses what already exists instead of building a parallel module, and the rejected alternatives are real,
  not strawmen.
- A finding names `spec.md:<line>` or `plan.md:<line>` and a concrete fix.
