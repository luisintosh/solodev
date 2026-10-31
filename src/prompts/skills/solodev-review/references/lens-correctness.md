# Correctness lens

Read each changed function as its callers will use it, with the inputs the feature will really see: empty, missing,
duplicate, large, concurrent. Name the input that breaks it; a finding without one isn't `major`. Search the repo for
every caller of a shared symbol the diff changes.

{{include:fragments/practices-correctness.md}}
