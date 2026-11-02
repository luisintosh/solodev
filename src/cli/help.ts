export type CommandHelp = { usage: string; summary: string; detail: string[]; example: string }

/** The single source for `solodev help`, `solodev help <command>` and `solodev <command> --help`. */
export const HELP: Record<string, CommandHelp> = {
  probe: {
    usage: "solodev probe",
    summary: "What's available: coding tools, their models, Orca, and this repo's folder of features.",
    detail: [
      "Prints JSON: each coding tool (installed, logged in, solodev skills present, think and implement models and",
      "their Orca launch fields), Orca (runtime ready, orchestration skill installed), `state`: this repo's folder of",
      "features (outside the repo) and whether this session can write there, personal defaults from",
      "~/.agents/solodev/solodev-conf.yaml, and `writers`: the coder options for the gate card, another tool first.",
    ],
    example: "solodev probe",
  },
  status: {
    usage: "solodev status [<slug>] [--json]",
    summary: "Where a feature stands and what comes next, worked out from its folder.",
    detail: [
      "Derives the stage (spec, gate, implement, review, pr, qa, done) from the feature folder: the approval line,",
      "review.md's findings and QA verdicts, and the `- pr <url> · draft|ready` lines in progress.md. Shows the",
      "`- tools:` line too.",
      "Without a slug: the feature the current feat/<slug> branch names, or one line per feature.",
    ],
    example: "solodev status csv-export",
  },
  approve: {
    usage: "solodev approve <slug>",
    summary: "Record the spec gate: an approval line in the feature's progress.md.",
    detail: [
      "Run only after the user approves. Checks the plan covers the spec (C1) and nothing is staged, then appends",
      "`- approved <date> · spec <hash of spec.md> · at <HEAD>` to progress.md. Commits nothing. Editing spec.md,",
      "its plan included, afterwards reopens the gate until the user approves again.",
    ],
    example: "solodev approve csv-export",
  },
  check: {
    usage: "solodev check <slug> [--for implement|pr|done] [--json]",
    summary: "Run the checks that must pass before implement → review, PR, or PR ready.",
    detail: [
      "Prints one line per check and exits 1 if any fails, naming what to fix. It reads only git and the feature",
      "folder and never runs the project's tools. C1 coverage: every scenario is claimed, and each journey test",
      "tags the scenarios it claims with `@S<n>` · C2 gate held · C3 reports only · C4 review settled · C5 QA",
      "verdicts. implement runs C1–C2, pr adds C3–C4, done adds C5. Without --for: the set for the stage.",
    ],
    example: "solodev check csv-export --for implement",
  },
  init: {
    usage: "solodev init [claude|codex|cursor] [--global|--project] [--force] [--dry-run] [--json]",
    summary: "Write the two shadow agents (shadow-coder, shadow-reviewer) for one coding tool.",
    detail: [
      "Run once per coding tool after `npx skills add luisintosh/solodev`. Without a tool: the one running this",
      "session. Scope follows where the skill is installed (under $HOME: global; in a repo: that repo); --global or",
      "--project overrides. Writes .claude/agents/*.md, .cursor/agents/*.md or .codex/agents/*.toml",
      "(global Codex: $CODEX_HOME/agents). A shadow you edited is kept, shown as a diff, and exits 1; --force",
      "replaces it.",
    ],
    example: "solodev init codex",
  },
  install: {
    usage: "npx skills add luisintosh/solodev [-g]",
    summary: "Install or update the solodev skills; then run `/mission init` in each coding tool.",
    detail: [
      "`npx skills update` updates them. Pin a release with",
      "npx skills add https://github.com/luisintosh/solodev/tree/vX.Y.Z.",
    ],
    example: "npx skills add luisintosh/solodev",
  },
  help: {
    usage: "solodev help [<command>]",
    summary: "This list, or `solodev help <command>` for usage, options and an example.",
    detail: ["Every command also takes --help."],
    example: "solodev help check",
  },
}

export function helpText(command?: string): string {
  if (command && HELP[command]) {
    const h = HELP[command]
    return [h.usage, ...h.detail.map((l) => `  ${l}`), `  Example: ${h.example}`].join("\n")
  }
  const width = Math.max(...Object.keys(HELP).map((k) => k.length))
  return [
    "solodev: checks for a /mission feature run. Its checks read git and the feature folder; it commits nothing.",
    "",
    ...Object.entries(HELP).map(([name, h]) => `  ${name.padEnd(width)}  ${h.summary}`),
  ].join("\n")
}
