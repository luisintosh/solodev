# remove-user: plan

Add `src/users.js` exporting `createStore(users)`: a `Map` by id, `list()` returns its values, and `remove(id, token)`
checks the token against `process.env.ADMIN_TOKEN` before deleting. Only one viable approach.

## Setup

`ADMIN_TOKEN` is read from the environment.

```yaml
journeys:
  - id: J1
    scenarios: [S1, S2, S3]
    test: src/users.test.js
    command: npx vitest run src/users.test.js
uncovered: []
```
