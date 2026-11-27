# Correctness lens

Read each changed function as its callers will use it, with the inputs the feature will really see: empty, missing,
duplicate, large, concurrent, and name the input that breaks it. Search the repo for
every caller of a shared symbol the diff changes. When no security lens runs in this review, also check the security
list below: a change judged not sensitive can still log a token or pass input to a shell.

## Correctness

- **Bugs:** no inverted condition, off-by-one, unhandled empty or missing input, or error branch that returns success,
  under inputs the feature will really see.
- **Silent failure:** errors propagate. No swallowed exception, empty catch, default that masks a failed call, or throw
  turned into a logged warning. The quickest way to make a failing test pass is to stop propagating its error.
- **Blast radius:** a changed shared symbol, signature, default or export has every caller found and updated.
- **Stale writes:** a write sends the version or id the client read when the user opened it, not one fetched since, and
  a target that changed in between is refused or handled as the spec says.

## Security

- **Access:** authorization on every newly reachable path, checked on the server side, for the resource asked for and
  not only for the user.
- **Input:** validation where input crosses a trust boundary; no input reaches a query, shell, path or template
  unescaped.
- **Secrets:** no secrets or tokens in code, logs, error messages or test fixtures.
- **Data:** a delete or overwrite can't hit more rows than the user meant, and a migration runs safely on existing data
  and states how it is undone.
