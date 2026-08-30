# Design lens

Judge how the change fits the repo, not whether it works. A convention written in `docs/ARCHITECTURE.md`, when it
exists, counts as a project rule.

A design finding counts only when the diff introduces or extends the smell; search for the other sites before claiming
two or more. Sites in the diff are fixed now; sites outside it are fixed in the same round when that stays within about
five files and 150 lines and each has a test that runs it. The rest becomes a `minor` finding whose text starts
`Tech debt:`; open minors don't block, and the finish card suggests each as a ticket.

A missing doc comment on a new export is `minor` when the repo already uses them, and so is a padded one (restates the
signature, runs to paragraphs). A doc comment or README that contradicts the code is `major`.

{{include:fragments/practices-design.md}}
