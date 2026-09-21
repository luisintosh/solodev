#!/usr/bin/env bash
set -euo pipefail

# e2e for the built product (dist/product) laid out the way `npx skills add` installs it, `solodev init` for each
# coding tool, and the installed solodev CLI. No network unless E2E_NPX_SKILLS=1.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCT="${REPO_ROOT}/dist/product"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0

ok() { pass=$((pass + 1)); printf 'ok   - %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL - %s\n' "$1"; }

assert_file_exists() {
  if [[ -f "$1" ]]; then ok "$2"; else bad "$2 (missing: $1)"; fi
}

assert_file_absent() {
  if [[ ! -e "$1" ]]; then ok "$2"; else bad "$2 (still present: $1)"; fi
}

assert_eq() {
  if [[ "$1" == "$2" ]]; then ok "$3"; else bad "$3 (expected [$2], got [$1])"; fi
}

assert_grep() {
  if grep -q -- "$1" <<<"$2"; then ok "$3"; else bad "$3 (no '$1' in: $2)"; fi
}

SKILLS=(solodev-mission solodev-plan solodev-code solodev-review solodev-verify solodev-roadmap solodev-scout)
SHADOWS=(shadow-coder shadow-reviewer)
CLI_REL="skills/solodev-mission/scripts/solodev-cli.mjs"

# 0. build output: the product holds the skills, the CLI inside solodev-mission, README.md, LICENSE and assets/
(cd "$REPO_ROOT" && pnpm run build >/dev/null)
assert_eq "$(find "$PRODUCT" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort | tr '\n' ' ')" "LICENSE README.md assets skills " "dist/product holds only what master ships"
for skill in "${SKILLS[@]}"; do
  assert_file_exists "${PRODUCT}/skills/${skill}/SKILL.md" "${skill} skill built"
done
assert_file_exists "${PRODUCT}/${CLI_REL}" "the CLI ships inside solodev-mission"
if [[ -x "${PRODUCT}/${CLI_REL}" ]]; then ok "the CLI is executable"; else bad "the CLI is executable"; fi
assert_grep 'spawn_agent' "$(cat "${PRODUCT}/skills/solodev-mission/SKILL.md")" "solodev-mission documents Codex spawn_agent"
if grep -q '^model:' "${PRODUCT}/skills/solodev-mission/SKILL.md"; then
  bad "skills carry no model"
else
  ok "skills carry no model"
fi

# 1. a project install: skills in .agents/skills (canonical) with .claude/skills linked to it, as `npx skills` does
TARGET="${WORK}/consumer-repo"
mkdir -p "${TARGET}/.agents" "${TARGET}/.claude"
(cd "$TARGET" && git init -q -b main && git config user.email test@example.com && git config user.name test)
echo "# consumer" >"${TARGET}/AGENTS.md"
cp -R "${PRODUCT}/skills" "${TARGET}/.agents/skills"
mkdir -p "${TARGET}/.claude/skills"
for skill in "${SKILLS[@]}"; do ln -s "../../.agents/skills/${skill}" "${TARGET}/.claude/skills/${skill}"; done
export SOLODEV_STATE="${WORK}/state"
mkdir -p "${SOLODEV_STATE}/consumer-repo/kept"
echo "# kept" >"${SOLODEV_STATE}/consumer-repo/kept/spec.md"

SOLODEV="${TARGET}/.claude/${CLI_REL}"
init_out="$(cd "$TARGET" && "$SOLODEV" init claude)"
assert_grep '(project: ' "$init_out" "init follows the skill's project scope"
for shadow in "${SHADOWS[@]}"; do
  assert_file_exists "${TARGET}/.claude/agents/${shadow}.md" "init claude writes ${shadow}"
done
assert_grep '- solodev-code' "$(cat "${TARGET}/.claude/agents/shadow-coder.md")" "claude shadow-coder preloads solodev-code"
assert_file_exists "${SOLODEV_STATE}/consumer-repo/kept/spec.md" "init never touches feature folders"
(cd "$TARGET" && SOLODEV_HOME=codex "$SOLODEV" init >/dev/null)
(cd "$TARGET" && "$SOLODEV" init cursor >/dev/null)
for shadow in "${SHADOWS[@]}"; do
  assert_file_exists "${TARGET}/.codex/agents/${shadow}.toml" "init (SOLODEV_HOME=codex) writes ${shadow}"
  assert_file_exists "${TARGET}/.cursor/agents/${shadow}.md" "init cursor writes ${shadow}"
done
assert_grep 'unchanged' "$(cd "$TARGET" && "$SOLODEV" init claude)" "a second init changes nothing"

# 2. an edited shadow is kept until --force
echo "my rule" >>"${TARGET}/.claude/agents/shadow-coder.md"
set +e
edited_out="$(cd "$TARGET" && "$SOLODEV" init claude 2>&1)"
edited_rc=$?
set -e
assert_eq "$edited_rc" "1" "init exits 1 on an edited shadow"
assert_grep '+my rule\|-my rule' "$edited_out" "init shows the edit as a diff"
assert_grep 'my rule' "$(cat "${TARGET}/.claude/agents/shadow-coder.md")" "init keeps the edit"
(cd "$TARGET" && "$SOLODEV" init claude --force >/dev/null)
if grep -q 'my rule' "${TARGET}/.claude/agents/shadow-coder.md"; then
  bad "--force replaces the edited shadow"
else
  ok "--force replaces the edited shadow"
fi

# 3. no tool named and none detected: a usage error
set +e
(cd "$TARGET" && env -u CLAUDECODE -u CURSOR_AGENT -u CODEX_SANDBOX -u CODEX_THREAD_ID -u SOLODEV_HOME "$SOLODEV" init >/dev/null 2>&1)
nohost_rc=$?
set -e
assert_eq "$nohost_rc" "2" "init without a detectable tool is a usage error"

# 3b. a cloned repo's symlinks can't steer init outside it: nothing written there
EVIL="${WORK}/evil-repo"
OUTSIDE="${WORK}/outside"
mkdir -p "${EVIL}/.claude" "$OUTSIDE"
(cd "$EVIL" && git init -q)
cp -R "${PRODUCT}/skills" "${EVIL}/.claude/skills"
ln -s "$OUTSIDE" "${EVIL}/.cursor"
set +e
evil_out="$(cd "$EVIL" && "${EVIL}/.claude/${CLI_REL}" init cursor 2>&1)"
evil_rc=$?
set -e
assert_eq "$evil_rc" "1" "init exits 1 when a symlink leads outside the repo"
assert_grep 'outside' "$evil_out" "init reports what it left alone"
assert_file_absent "${OUTSIDE}/agents" "init writes nothing outside the repo"

# 4. the installed solodev CLI runs a feature through the gate and the implement checks
# (a CommonJS package.json nearby must not break the ESM .mjs)
printf '%s\n' '{"name":"consumer","type":"commonjs"}' >"${TARGET}/package.json"
printf '%s\n' .agents/ .claude/ .codex/ .cursor/ >>"${TARGET}/.git/info/exclude"
(cd "$TARGET" && git add -A && git commit -q -m "chore: init" && git checkout -q -b feat/hello)
# feature state lives outside the repo; without an origin it's keyed by the checkout's folder name
FEATURE="${SOLODEV_STATE}/consumer-repo/hello"
mkdir -p "$FEATURE"
printf '# Hello\n\n## Acceptance\n\n- @S1 Given nothing, when I call hello, then it returns "hello".\n' \
  >"${FEATURE}/spec.md"
cat >>"${FEATURE}/spec.md" <<'EOF'

## Plan

```yaml
journeys:
  - id: J1
    scenarios: [S1]
    test: test/hello.test.mjs
    command: node test/hello.test.mjs
```
EOF
status_out="$(cd "$TARGET" && "$SOLODEV" status)"
assert_grep 'hello: gate' "$status_out" "solodev status finds the feature waiting at the gate"
head_before="$(cd "$TARGET" && git rev-parse HEAD)"
approve_out="$(cd "$TARGET" && "$SOLODEV" approve hello)"
assert_grep 'approved hello: spec ' "$approve_out" "solodev approve records the gate"
assert_grep '^- approved .* · spec [0-9a-f]* · at [0-9a-f]*$' "$(cat "${FEATURE}/progress.md")" \
  "the approval line lands in the feature's progress.md"
assert_eq "$(cd "$TARGET" && git rev-parse HEAD)" "$head_before" "solodev approve commits nothing to the repo"
assert_eq "$(cd "$TARGET" && git status --porcelain)" "" "solodev approve leaves the repo clean"
mkdir -p "${TARGET}/test" "${TARGET}/src"
printf 'import assert from "node:assert"\nimport { hello } from "../src/hello.mjs"\nassert.strictEqual(hello(), "hello") // @S1\n' \
  >"${TARGET}/test/hello.test.mjs"
printf 'export const hello = () => "hello"\n' >"${TARGET}/src/hello.mjs"
(cd "$TARGET" && git add test src && git commit -q -m "feat: add hello")
set +e
check_out="$(cd "$TARGET" && SOLODEV_BASE=main "$SOLODEV" check hello --for implement 2>&1)"
check_rc=$?
set -e
assert_eq "$check_rc" "0" "solodev check --for implement passes a tagged journey after the gate"
assert_grep '1 scenarios, 1 journey test' "$check_out" "C1 finds the journey test and its @S1 tag"
set +e
(cd "$TARGET" && SOLODEV_BASE=main "$SOLODEV" check hello --for pr >/dev/null 2>&1)
pr_rc=$?
set -e
assert_eq "$pr_rc" "1" "solodev check --for pr fails without a review"

# 4b. help and usage errors
assert_grep 'approve' "$("$SOLODEV" help)" "solodev help lists the commands"
assert_grep 'solodev init' "$("$SOLODEV" help init)" "solodev help explains init"
set +e
(cd "$TARGET" && "$SOLODEV" check no-such-feature >/dev/null 2>&1)
usage_rc=$?
set -e
assert_eq "$usage_rc" "2" "solodev exits 2 on a usage error"

# 5. a global install: skills under $HOME, init writes the shadows there
FAKE_HOME="${WORK}/fake-home"
mkdir -p "${FAKE_HOME}/.claude" "${FAKE_HOME}/.codex" "${FAKE_HOME}/.cursor/agents"
cp -R "${PRODUCT}/skills" "${FAKE_HOME}/.claude/skills"
printf '%s' "user-agent" >"${FAKE_HOME}/.cursor/agents/user-agent.md"
printf '%s' '{"keep":true}' >"${FAKE_HOME}/.claude/settings.json"
GLOBAL_TARGET="${WORK}/global-consumer"
mkdir -p "$GLOBAL_TARGET"
(cd "$GLOBAL_TARGET" && git init -q)
GSOLODEV="${FAKE_HOME}/.claude/${CLI_REL}"
global_out="$(cd "$GLOBAL_TARGET" && HOME="$FAKE_HOME" "$GSOLODEV" init claude)"
assert_grep '(global: ~)' "$global_out" "init follows the skill's global scope"
assert_file_exists "${FAKE_HOME}/.claude/agents/shadow-coder.md" "global claude shadows land in ~/.claude/agents"
assert_file_absent "${GLOBAL_TARGET}/.claude" "a global init writes nothing into the repo"
(cd "$GLOBAL_TARGET" && HOME="$FAKE_HOME" CODEX_HOME="${WORK}/codex-home" "$GSOLODEV" init codex >/dev/null)
assert_file_exists "${WORK}/codex-home/agents/shadow-coder.toml" "global codex shadows follow CODEX_HOME"
(cd "$GLOBAL_TARGET" && HOME="$FAKE_HOME" "$GSOLODEV" init cursor >/dev/null)
assert_file_exists "${FAKE_HOME}/.cursor/agents/shadow-reviewer.md" "global cursor shadows land in ~/.cursor/agents"
assert_file_exists "${FAKE_HOME}/.cursor/agents/user-agent.md" "init keeps the user's own agents"
assert_eq "$(cat "${FAKE_HOME}/.claude/settings.json")" '{"keep":true}' "init leaves claude settings.json alone"
(cd "$GLOBAL_TARGET" && HOME="$FAKE_HOME" "$GSOLODEV" init claude --project >/dev/null)
assert_file_exists "${GLOBAL_TARGET}/.claude/agents/shadow-coder.md" "--project overrides a global skill's scope"

# 6. optional: the real `npx skills add` from the built product (needs network)
if [[ "${E2E_NPX_SKILLS:-}" == "1" ]]; then
  NPX_TARGET="${WORK}/npx-consumer"
  mkdir -p "$NPX_TARGET"
  (cd "$NPX_TARGET" && git init -q)
  (cd "$NPX_TARGET" && npx -y skills add "$PRODUCT" -y --copy -a claude-code >/dev/null 2>&1)
  assert_file_exists "${NPX_TARGET}/.claude/${CLI_REL}" "npx skills add installs the CLI with solodev-mission"
  (cd "$NPX_TARGET" && "${NPX_TARGET}/.claude/${CLI_REL}" init claude >/dev/null)
  assert_file_exists "${NPX_TARGET}/.claude/agents/shadow-coder.md" "init after npx skills add writes the shadows"
else
  ok "npx skills add (skipped: set E2E_NPX_SKILLS=1)"
fi

echo ""
echo "${pass} passed, ${fail} failed"
[[ $fail -eq 0 ]]
