# Sources beyond the code

A prototype, a design board or a written doc the user hands you counts as evidence, like the code. Read it before you
write the requirements it covers, and say which source each rule came from when the user asks.

- **Prototype code:** derive the behavior rules from it: statuses and their transitions, validations, the disabled and
  empty states, what each action does. The prototype shows intended behavior, not the target architecture.
- **Flow diagrams and boards:** each branch of a flow is a candidate scenario. A branch the board leaves out, such as an
  error or a rejection, is an open question.
- **Field-mapping tables:** check each field against the data model. A field with no column, a type or nullability
  mismatch, or a constraint that rejects a valid case goes on the open questions list as a gap.
- **Unreadable sources:** a link you can't open or a file you weren't given is a blocker until the user shares it or
  says to proceed without it.

When two sources disagree, such as the ticket and the prototype, or the board and the code, raise it as an open question
instead of picking one.
