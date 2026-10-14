# greet: plan

Add `src/greet.js` exporting `greet(name)`, and have `src/index.js` read `--name` from its arguments, defaulting to
`world`. Only one viable approach.

## Setup

None.

```yaml
journeys:
  - id: J1
    scenarios: [S1, S2, S3]
    test: src/greet.test.js
    command: npx vitest run src/greet.test.js
uncovered: []
```
