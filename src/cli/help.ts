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
      "review.md, qa.md, and the `- pr <url> · draft|ready` lines in progress.md. Shows the `- tools:` line too.",
      "Without a slug: the feature the current feat/<slug> branch names, or one line per feature.",
    ],
    example: "solodev status csv-export",
  },
  approve: {
    usage: "solodev approve <slug>",
    summary: "Record the spec gate: an approval line in the feature's progress.md.",
    detail: [
      "Run only after the user approves. Checks the plan covers the spec (C1) and nothing is staged, then appends",
      "`- approved <date> · spec <hash of spec.md + plan.md> · at <HEAD>` to progress.md. Commits nothing. Editing",
      "spec.md or plan.md afterwards reopens the gate until the user approves again.",
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
    "solodev: checks and evidence for a /solodev-mission feature run. Reads git and the feature folder; commits nothing.",
    "",
    ...Object.entries(HELP).map(([name, h]) => `  ${name.padEnd(width)}  ${h.summary}`),
  ].join("\n")
}
