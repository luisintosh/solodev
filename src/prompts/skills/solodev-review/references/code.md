# Code review checklist

One pass over the whole diff covers all three areas. Test files in the diff are under review too, not evidence.

{{include:fragments/practices.md}}

## Structure findings

A structural finding counts only when the diff introduces or extends the smell; search for the other sites before
claiming two or more. A convention written in `docs/ARCHITECTURE.md`, when it exists, counts as a project rule. Sites in
the diff are fixed now; sites outside it are fixed in the same round when that stays within about five files and 150
lines and each has a test that runs it. The rest becomes a `minor` finding whose text starts `Tech debt:`; open minors
don't block, and the finish card suggests each as a ticket.

A missing doc comment on a new export is `minor` when the repo already uses them, and so is a padded one (restates the
signature, runs to paragraphs). A doc comment or README that contradicts the code is `major`.

A large diff: review the riskiest files first and name in your reply what you didn't reach.
