export type CommandHelp = { usage: string; summary: string; detail: string[]; example: string }

/** The single source for `solodev help`, `solodev help <command>` and `solodev <command> --help`. */
export const HELP: Record<string, CommandHelp> = {
  probe: {
    usage: "solodev probe",
    summary: "What's available: coding tools, their coder, and this repo's folder of features.",
    detail: [
      "Prints JSON: each coding tool (installed, logged in, solodev skills present, and `coder`: what the coder starts",
      "on, as `<model>/<effort>` or `session`, passed through for the commander to resolve), `state`: this repo's",
      "folder of features (outside the repo) and whether this session can write there, personal defaults from",
      "~/.agents/solodev/solodev-conf.yaml, and `writers`: the coder options for the gate card, another tool first.",
      "Every other role runs on the session's model and effort.",
    ],
    example: "solodev probe",
  },
  status: {
    usage: "solodev status [<slug>] [--json]",
    summary: "Where a feature stands and what comes next, worked out from its folder.",
    detail: [
      "Derives the stage (spec, gate, implement, review, pr, qa, done) from the feature folder: the approval line,",
      "review.md's findings and QA verdicts, and the `- pr <url> · draft|ready` lines in progress.md. Shows the",
      "`- tools:` line too, and on the feature's own branch the base the checks use (see check).",
      "Without a slug: the feature the current feat/<slug> branch names, or one line per feature.",
    ],
    example: "solodev status csv-export",
  },
  approve: {
    usage: "solodev approve <slug>",
    summary: "Record the spec gate: an approval line in the feature's progress.md.",
    detail: [
      "Run only after the user approves. Checks the plan covers the spec (C1) and nothing is staged, then appends",
      "`- approved <date> · spec <hash of spec.md> · at <HEAD> · early <n>` to progress.md, n being the branch's",
      "commits past its base (see check). The first approval refuses n > 0: code before the gate, or the wrong base.",
      "Commits nothing. Editing spec.md, its plan included, afterwards reopens the gate until the user approves again.",
    ],
    example: "solodev approve csv-export",
  },
  check: {
    usage: "solodev check <slug> [--for gate|implement|pr|done] [--json]",
    summary: "Run the checks that must pass before the gate card, implement → review, PR, or PR ready.",
    detail: [
      "Prints one line per check and exits 1 if any fails, naming what to fix. It reads only git and the feature",
      "folder and never runs the project's tools. C1 coverage: every scenario is claimed, and each journey test tags",
      "the scenarios it claims with `@S<n>` · C2 gate held: the first approval saw no commit past the base, which a",
      "rebase leaves standing · C3 reports only · C4 review settled (no open blocker or",
      "major, no failed QA verdict) · C5 QA verdicts · C6 proof recorded: each journey has a red, then a green on the",
      "tree as it stands. implement runs C1, C2 and C6; pr runs C1–C4 and C6; done adds C5. gate runs C1 on the plan",
      "alone, before any test exists, and notes a feature large enough to split. Without --for: the set for the",
      "stage. The base is where the branch forked from the branch its PR targets: SOLODEV_BASE, else the last",
      "`- base <ref>` line in progress.md (origin's copy or the local one, whichever is later), else origin's",
      "default branch, else main or master. A named base that doesn't resolve is an error.",
    ],
    example: "solodev check csv-export --for implement",
  },
  proof: {
    usage: "solodev proof <slug> <journey>[,<journey>…] red|green --exit <code> --why '<output line>'",
    summary: "Record a run of a journey's command, or several journeys' tests run together, in progress.md.",
    detail: [
      "Runs nothing: run the command as its own call, so your tool's permission rules and hooks see it, then record",
      "it. Appends `- proof <journey> red|green · exit <code> · tree <hash>` with the hash of the working tree as it",
      "stands (tracked and untracked files) and the --why line: the output line that shows the result, the failure",
      "for a red and the pass count for a green. red is the journey test failing without the code (set aside, or not",
      "written yet), so it needs a non-zero exit; green needs 0. Any change to the tree after a green makes it stale",
      "for C6: run the command and record it again. A red counts only on another tree than the green. A green may",
      "name several journeys (J1,J2) whose tests ran in one run: one line each, on one tree, the --why line once. A",
      "red names one, since a run of several can fail on one alone. Put the --why line in single quotes, dropping any",
      "' in it, so the shell expands nothing in it; it is taken as written, even when it starts with --.",
    ],
    example: "solodev proof csv-export J1 red --exit 1 --why 'AssertionError: expected a,b got undefined'",
  },
  init: {
    usage: "solodev init [claude|codex|cursor] [--global|--project] [--force] [--dry-run] [--json]",
    summary: "Write the coder shadow agent for one coding tool.",
    detail: [
      "Run once per coding tool after `npx skills add luisintosh/solodev`. Without a tool: the one running this",
      "session. Scope follows where the skill is installed (under $HOME: global; in a repo: that repo); --global or",
      "--project overrides. Writes .claude/agents/*.md, .cursor/agents/*.md or .codex/agents/*.toml",
      "(global Codex: $CODEX_HOME/agents). A shadow you edited is kept, shown as a diff, and exits 1; --force",
      "replaces it. A shadow an earlier release wrote and that has since been retired is removed, unless you changed",
      "it.",
    ],
    example: "solodev init codex",
  },
  coder: {
    usage: "solodev coder [claude|codex|cursor] [<model>/<effort> | session | default]",
    summary: "Show or set what the coder starts on, per coding tool.",
    detail: [
      "Without a value: each tool's coder, yours or the default. With one: writes `coder.<tool>` in",
      "~/.agents/solodev/solodev-conf.yaml, keeping its comments; `default` removes yours. The value is a short",
      "<model>/<effort> (opus/high, sol/xhigh) the commander resolves to the tool's model when it starts the coder, or",
      "session for the session's own. A value without a tool is for the tool running this session. It applies from",
      "the next /solo-task run; nothing to re-init.",
    ],
    example: "solodev coder codex sol/xhigh",
  },
  install: {
    usage: "npx skills add luisintosh/solodev [-g]",
    summary: "Install or update the solodev skills; then run `/solo-task init` in each coding tool.",
    detail: ["`npx skills update` updates them. Pin a release with", "npx skills add luisintosh/solodev@vX.Y.Z."],
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
    "solodev: checks for a /solo-task feature run. Its checks read git and the feature folder; it commits nothing.",
    "",
    ...Object.entries(HELP).map(([name, h]) => `  ${name.padEnd(width)}  ${h.summary}`),
  ].join("\n")
}
