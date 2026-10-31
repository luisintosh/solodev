```yaml
status: done
journeys: [J1]
files_changed: [src/users.js, src/users.test.js]
decisions: []
findings:
  - id: R1
    result: fixed
    reason: the token is checked before the delete; @S2 and @S3 now assert user 1 is still listed
question: ""
blocked: ""
headline: R1 fixed; a denied removal no longer deletes the user.
```
