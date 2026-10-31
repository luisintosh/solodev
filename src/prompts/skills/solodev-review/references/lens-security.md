# Security lens

Follow every input the diff adds or newly trusts from where it enters to where it's used, and every path it makes
reachable to the check that guards it. A hole a realistic caller can reach, or a write that can lose data, is a
`blocker`; a missing defense with no reachable exploit yet is a `major`.

{{include:fragments/practices-security.md}}
