# greet: code review

| id  | severity | location       | status | finding                                         |
| --- | -------- | -------------- | ------ | ----------------------------------------------- |
| R1  | major    | src/index.js:5 | fixed  | `npm run dev` without --name printed undefined  |
| R2  | minor    | src/greet.js:2 | open   | greet("") returns "Hello, !"; out of scope here |
