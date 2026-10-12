export type CommandHelp = { usage: string; summary: string; detail: string[]; example: string }

/** The single source for `solodev help`, `solodev help <command>` and `solodev <command> --help`. */
export const HELP: Record<string, CommandHelp> = {
  probe: {
    usage: "solodev probe",
    summary: "What's available: coding tools, their models, Orca, gh, the AGENTS.md commands list.",
    detail: [
      "Prints JSON: each coding tool (installed, logged in, solodev skills present, think and implement models and",
      "their Orca launch fields), Orca (runtime ready, orchestration skill installed), gh, the AGENTS.md commands,",
      "personal defaults from ~/.agents/solodev.yaml, and `writers`: the coder options for the gate card, another",
      "tool first. Read-only; takes a few seconds.",
    ],
    example: "solodev probe",
  },
  status: {
    usage: "solodev status [<slug>] [--json]",
    summary: "Where a feature stands and what comes next, worked out from git and its files.",
    detail: [
      "Derives the stage (spec, gate, implement, review, pr, qa, done) from docs/feats/<slug>/, the approval",
      "commit and the branch's PR, and prints the next step. Without a slug: the feature the current feat/<slug>",
      "branch names, or one line per feature. Nothing stores the stage, so this is always current.",
    ],
    example: "solodev status csv-export",
  },
  approve: {
    usage: "solodev approve <slug> --writer claude|codex|cursor [--via native|orca]",
    summary: "Record the spec gate: commit the spec and plan with who writes the code.",
    detail: [
      "Run only after the user approves. Checks the plan covers the spec (C2), then commits docs/feats/<slug>/ with",
      "the trailers Solodev-Gate: approved and Solodev-Writer: <tool>/<model>/<effort> via <native|orca>. --via",
      "defaults to native for the tool running this session and orca for any other.",
    ],
    example: "solodev approve csv-export --writer codex",
  },
  check: {
    usage: "solodev check <slug> [--for implement|pr|done] [--json]",
    summary: "Run the checks that must pass before implement → review, PR, or PR ready.",
    detail: [
      "Prints one line per check and exits 1 if any fails, naming what to fix. --for implement proves each",
      "journey's test fails against the gate commit's code and passes now (C3) and every new env var is documented",
      "(C9); pr adds the full commands, the gate order, report-only reviews and a settled review; done adds QA",
      "verdicts. Without --for: the set for the stage. C1 commands · C2 coverage · C3 fail then pass · C4 tests not",
      "weakened (a warning: ask the user) · C5 gate before code · C6 reports only · C7 review settled · C8 QA verdicts",
      "· C9 config documented.",
    ],
    example: "solodev check csv-export --for implement",
  },
  install: {
    usage: "npx -y github:luisintosh/solodev [install] [--dry-run] [--doctor] [--yes]",
    summary: "Install or update solodev for Claude Code, Codex and Cursor.",
    detail: [
      "Runs from the published package, which carries the files it installs. Scope and hosts are asked, or set",
      "with INSTALL_SCOPE=project|global and INSTALL_TARGET=all|claude,codex,cursor.",
    ],
    example: "npx -y github:luisintosh/solodev",
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
    "solodev: checks and evidence for an /arise feature run. Holds no state; reads git and docs/feats/<slug>/.",
    "",
    ...Object.entries(HELP).map(([name, h]) => `  ${name.padEnd(width)}  ${h.summary}`),
  ].join("\n")
}
