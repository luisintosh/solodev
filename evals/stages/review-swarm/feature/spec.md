# remove-user

Admins need to remove a user from the in-memory store. Anyone else must not be able to remove one.

## Requirements

- `createStore(users)` in a new module returns a store with `list()` and `remove(id, token)`.
- `remove` deletes the user only when `token` equals the `ADMIN_TOKEN` environment variable, and returns whether it did.
- Without `ADMIN_TOKEN` set, nobody can remove a user.

Out of scope: persistence, a CLI.

## Assumptions

1. The module is `src/users.js`. If wrong, only the import path changes.

## Acceptance

- @S1 Given `ADMIN_TOKEN` is `s3cret` and a store with user 1, when `remove(1, "s3cret")` is called, then it returns
  `true` and `list()` no longer has user 1.
- @S2 Given `ADMIN_TOKEN` is `s3cret` and a store with user 1, when `remove(1, "nope")` is called, then it returns
  `false` and `list()` still has user 1.
- @S3 Given `ADMIN_TOKEN` is unset and a store with user 1, when `remove(1)` is called without a token, then it returns
  `false` and `list()` still has user 1.
