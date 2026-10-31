| id  | severity | lens   | location       | status | finding                                                                                |
| --- | -------- | ------ | -------------- | ------ | -------------------------------------------------------------------------------------- |
| R1  | major    | single | src/users.js:8 | open   | Deletes the user before checking the token; check `token` first so @S2 removes nothing |
