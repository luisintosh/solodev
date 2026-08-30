# Contract lens

Walk each scenario in `spec.md` and each journey in `plan.md` through the diff: find the code that makes its
Given/When/Then hold and the assertion that proves it. A violated scenario is a `blocker`; a changed code path no test
asserts, or a scenario its journey test doesn't really pin, is a `major`. Judge the coder's `decisions:` from the brief
against the spec, and put a spec or plan gap in `notes`.

{{include:fragments/practices-contract.md}}
