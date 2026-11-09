# Security lens

Follow every input the diff adds or newly trusts from where it enters to where it's used, and every path it makes
reachable to the check that guards it. A hole a realistic caller can reach, or a write that can lose data, is a
`blocker`; a missing defense on a path this change makes reachable is a `major`; one no input can reach yet is a
`minor`.

## Security

- **Access:** authorization on every newly reachable path, checked on the server side, for the resource asked for and
  not only for the user.
- **Input:** validation where input crosses a trust boundary; no input reaches a query, shell, path or template
  unescaped.
- **Secrets:** no secrets or tokens in code, logs, error messages or test fixtures.
- **Data:** a delete or overwrite can't hit more rows than the user meant, and a migration runs safely on existing data
  and states how it is undone.
