#!/usr/bin/env bash
set -euo pipefail

# Tier 1 e2e for bin/install.js and the installed solodev CLI — LOCAL_SOURCE, no network.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_JS="${REPO_ROOT}/bin/install.js"
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

# 0. build output
(cd "$REPO_ROOT" && pnpm run build >/dev/null)

for host in claude cursor; do
  for shadow in shadow-coder shadow-reviewer; do
    assert_file_exists "${REPO_ROOT}/dist/${host}/agents/${shadow}.md" "transpile emits ${host} ${shadow}"
  done
done
assert_file_exists "${REPO_ROOT}/dist/codex/agents/shadow-coder.toml" "transpile emits codex shadow-coder"
assert_grep 'spawn_agent' "$(cat "${REPO_ROOT}/dist/agents/skills/solodev-mission/SKILL.md")" "solodev-mission skill documents Codex spawn_agent"
assert_grep 'model: claude-opus-5-5' "$(cat "${REPO_ROOT}/dist/claude/skills/solodev-mission/SKILL.md")" \
  "claude solodev-mission skill runs on the think model"
assert_grep '- solodev-code' "$(cat "${REPO_ROOT}/dist/claude/agents/shadow-coder.md")" "claude shadow-coder preloads solodev-code"
assert_file_exists "${INSTALL_JS}" "build emits npx/bunx installer"

UPSTREAM="${WORK}/upstream"
mkdir -p "$UPSTREAM"
cp "${REPO_ROOT}/manifest.txt" "$UPSTREAM/"
cp -R "${REPO_ROOT}/dist" "$UPSTREAM/dist"

restore_upstream() {
  rm -rf "${UPSTREAM}/dist"
  cp -R "${REPO_ROOT}/dist" "${UPSTREAM}/dist"
  cp "${REPO_ROOT}/manifest.txt" "$UPSTREAM/"
}

TARGET="${WORK}/consumer-repo"
mkdir -p "$TARGET"
(cd "$TARGET" && git init -q -b main && git config user.email test@example.com && git config user.name test)
echo "# consumer" >"${TARGET}/AGENTS.md"

# 1. dry-run + fresh install (all)
LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" --dry-run >/dev/null
LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" >/dev/null

for shadow in shadow-coder shadow-reviewer; do
  assert_file_exists "${TARGET}/.claude/agents/${shadow}.md" "claude ${shadow} installed"
  assert_file_exists "${TARGET}/.cursor/agents/${shadow}.md" "cursor ${shadow} installed"
  assert_file_exists "${TARGET}/.codex/agents/${shadow}.toml" "codex ${shadow} installed"
done
for skill in "${SKILLS[@]}"; do
  assert_file_exists "${TARGET}/.agents/skills/${skill}/SKILL.md" "${skill} skill installed under .agents"
  assert_file_exists "${TARGET}/.claude/skills/${skill}/SKILL.md" "${skill} skill installed under .claude"
done
for ref in gate orca pr; do
  assert_file_exists "${TARGET}/.agents/skills/solodev-mission/references/${ref}.md" "solodev-mission ${ref} reference installed"
done
assert_file_exists "${TARGET}/.claude/skills/solodev-review/references/code.md" "reviewer checklist installed for claude"
if [[ -L "${TARGET}/.claude/skills/solodev-mission/SKILL.md" ]]; then
  bad "claude skills must be a copy, not a symlink"
else
  ok "claude skills are a copy, not a symlink"
fi
assert_file_exists "${TARGET}/.agents/bin/solodev.mjs" "solodev CLI installed under .agents/bin"
assert_file_absent "${TARGET}/.agents/bin/quest-state.mjs" "no v1 state CLI installed"
assert_file_absent "${TARGET}/.agents/solodev" "no v1 checklists or references tree"
assert_file_absent "${TARGET}/.opencode" "no .opencode directory installed"
for leaf in .cursor/agents .claude/agents .claude/skills .codex/agents .agents; do
  assert_file_exists "${TARGET}/${leaf}/.harness-manifest" "${leaf} harness-manifest recorded"
done

# 2. no-op reinstall
reinstall_output="$(LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" --dry-run 2>&1)"
if grep -q "+ create" <<<"$reinstall_output"; then bad "no-op reinstall creates files: $reinstall_output"; else ok "no-op reinstall creates nothing"; fi

# 3. local modify + overwrite (no backup)
before_hash="$(shasum -a 256 "${TARGET}/.claude/agents/shadow-coder.md" | awk '{print $1}')"
echo "LOCAL EDIT" >>"${TARGET}/.claude/agents/shadow-coder.md"
modify_output="$(LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" 2>&1)"
assert_grep "overwrite claude/agents/shadow-coder.md" "$modify_output" "reports locally-modified claude agent"
backup_copy="$(find "${TARGET}/.claude" -path '*/.backup-*' | head -1)"
if [[ -z "$backup_copy" ]]; then ok "did not create a .backup-* directory"; else bad "unexpected backup: $backup_copy"; fi
after_hash="$(shasum -a 256 "${TARGET}/.claude/agents/shadow-coder.md" | awk '{print $1}')"
assert_eq "$after_hash" "$before_hash" "locally-modified file restored to upstream"

# 4. prune an upstream-deleted file
rm "${UPSTREAM}/dist/claude/agents/shadow-reviewer.md"
HARNESS_ROOT="$UPSTREAM" node "${REPO_ROOT}/tools/gen-manifest.ts" >/dev/null
prune_output="$(LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" 2>&1)"
assert_grep "delete    claude/agents/shadow-reviewer.md" "$prune_output" "reports delete of claude/agents/shadow-reviewer.md"
assert_file_absent "${TARGET}/.claude/agents/shadow-reviewer.md" "shadow-reviewer.md removed after upstream deletion"

# 4a. an upgrade from v1 removes the v1 agents, skills, checklists and state CLI
restore_upstream
plant() { # <leaf> <relative path>: write a file and record it in that leaf's manifest, as v1 did
  mkdir -p "$(dirname "${TARGET}/$1/$2")"
  echo "v1" >"${TARGET}/$1/$2"
  printf '%s  %s\n' "$(shasum -a 256 "${TARGET}/$1/$2" | awk '{print $1}')" "$2" >>"${TARGET}/$1/.harness-manifest"
}
plant .claude/agents shadow-architect.md
plant .codex/agents shadow-implementer.toml
plant .agents skills/arise-plan/SKILL.md
plant .agents solodev/checklists/review-contract.md
plant .claude/skills arise-setup-docs/SKILL.md
echo "v1" >"${TARGET}/.agents/bin/quest-state.mjs"
LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" >/dev/null 2>&1
assert_file_absent "${TARGET}/.claude/agents/shadow-architect.md" "v1 claude agent removed on upgrade"
assert_file_absent "${TARGET}/.codex/agents/shadow-implementer.toml" "v1 codex agent removed on upgrade"
assert_file_absent "${TARGET}/.agents/skills/arise-plan" "v1 arise-plan skill folder removed on upgrade"
assert_file_absent "${TARGET}/.agents/solodev" "v1 checklists removed on upgrade"
assert_file_absent "${TARGET}/.claude/skills/arise-setup-docs" "v1 arise-setup-docs skill removed on upgrade"
assert_file_absent "${TARGET}/.agents/bin/quest-state.mjs" "v1 quest-state.mjs removed on upgrade"
assert_file_exists "${TARGET}/.claude/agents/shadow-reviewer.md" "v2 shadow-reviewer present after upgrade"

# 4b. prune a whole skill (rename) leaves no empty folder behind
rm -r "${UPSTREAM}/dist/agents/skills/solodev-roadmap" "${UPSTREAM}/dist/claude/skills/solodev-roadmap"
HARNESS_ROOT="$UPSTREAM" node "${REPO_ROOT}/tools/gen-manifest.ts" >/dev/null
LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" >/dev/null 2>&1
assert_file_absent "${TARGET}/.agents/skills/solodev-roadmap" "removed skill folder pruned from .agents/skills"
assert_file_absent "${TARGET}/.claude/skills/solodev-roadmap" "removed skill folder pruned from .claude/skills"
assert_file_exists "${TARGET}/.agents/skills/solodev-mission/SKILL.md" "other skills kept after prune"
restore_upstream
LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" >/dev/null 2>&1

# 5. doctor
BARE="${WORK}/no-git-no-agents"
mkdir -p "$BARE"
if TARGET_DIR="$BARE" node "$INSTALL_JS" --doctor >/dev/null 2>&1; then
  ok "--doctor exits 0 even with warnings"
else
  bad "--doctor should never fail"
fi

# 6. checksum mismatch aborts
TAMPERED="${WORK}/tampered-upstream"
cp -R "$UPSTREAM" "$TAMPERED"
echo "TAMPERED" >>"${TAMPERED}/dist/claude/agents/shadow-coder.md"
before_hash="$(shasum -a 256 "${TARGET}/.claude/agents/shadow-coder.md" | awk '{print $1}')"
set +e
LOCAL_SOURCE="$TAMPERED" TARGET_DIR="$TARGET" INSTALL_TARGET=claude node "$INSTALL_JS" >/dev/null 2>&1
rc=$?
set -e
if [[ $rc -ne 0 ]]; then ok "checksum mismatch exits non-zero"; else bad "checksum mismatch should abort"; fi
after_hash="$(shasum -a 256 "${TARGET}/.claude/agents/shadow-coder.md" | awk '{print $1}')"
assert_eq "$after_hash" "$before_hash" "no partial write after checksum mismatch"

# 7. doctor reports the solodev CLI and skills
doctor_output="$(TARGET_DIR="$TARGET" node "$INSTALL_JS" --doctor 2>&1)"
assert_grep 'solodev CLI:' "$doctor_output" "doctor reports the solodev CLI"
assert_grep 'solodev skills installed' "$doctor_output" "doctor reports the skills"
if grep -q 'rtk' <<<"$doctor_output"; then bad "doctor should not mention rtk"; else ok "doctor does not mention rtk"; fi

# 8. cursor-only target
TARGET2="${WORK}/cursor-only"
mkdir -p "$TARGET2"
(cd "$TARGET2" && git init -q)
LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET2" INSTALL_TARGET=cursor node "$INSTALL_JS" >/dev/null
assert_file_exists "${TARGET2}/.cursor/agents/shadow-coder.md" "cursor-only installs .cursor"
assert_file_absent "${TARGET2}/.claude" "cursor-only skips .claude"
assert_file_absent "${TARGET2}/.codex" "cursor-only skips .codex"
assert_file_exists "${TARGET2}/.agents/bin/solodev.mjs" "cursor-only still installs the solodev CLI"
assert_file_exists "${TARGET2}/.agents/skills/solodev-mission/SKILL.md" "cursor-only installs shared skills"

# 8b. prune leftover ./bin and .cursor/skills
mkdir -p "${TARGET2}/bin" "${TARGET2}/.cursor/skills/sddkit" "${TARGET2}/.cursor/skills/sddkit-epic" "${TARGET2}/.agents/bin"
for f in bin/quest-state .agents/bin/quest-state .agents/bin/quest-state.js .agents/bin/sddkit-state.mjs \
  .cursor/skills/sddkit-epic/SKILL.md .cursor/skills/sddkit/SKILL.md; do
  echo leftover >"${TARGET2}/${f}"
done
LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET2" INSTALL_TARGET=cursor node "$INSTALL_JS" >/dev/null
for f in bin/quest-state .agents/bin/quest-state .agents/bin/quest-state.js .agents/bin/sddkit-state.mjs \
  .cursor/skills/sddkit-epic/SKILL.md .cursor/skills/sddkit/SKILL.md; do
  assert_file_absent "${TARGET2}/${f}" "reinstall prunes leftover ${f}"
done
assert_file_exists "${TARGET2}/.agents/bin/solodev.mjs" "solodev CLI remains after leftover prune"

# 9. the installed solodev CLI runs a feature through the gate and the implement checks
# (a CommonJS package.json nearby must not break the ESM .mjs)
SOLODEV="${TARGET}/.agents/bin/solodev.mjs"
printf '%s\n' '{"name":"consumer","type":"commonjs"}' >"${TARGET}/package.json"
cat >"${TARGET}/AGENTS.md" <<'EOF'
# consumer

## Commands

- install: n/a
- dev: n/a
- build: `node -e "process.exit(0)"`
- test: `node test/hello.test.mjs`
- test_file: `node {file}`
- lint: n/a
- typecheck: n/a
EOF
(cd "$TARGET" && git add -A && git commit -q -m "chore: init" && git checkout -q -b feat/hello)
# feature state lives outside the repo; without an origin it's keyed by the checkout's folder name
export SOLODEV_STATE="${WORK}/state"
FEATURE="${SOLODEV_STATE}/consumer-repo/hello"
mkdir -p "$FEATURE"
printf '# Hello\n\n## Acceptance\n\n- @S1 Given nothing, when I call hello, then it returns "hello".\n' \
  >"${FEATURE}/spec.md"
cat >"${FEATURE}/plan.md" <<'EOF'
# Plan

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
printf 'import assert from "node:assert"\nimport { hello } from "../src/hello.mjs"\nassert.strictEqual(hello(), "hello")\n' \
  >"${TARGET}/test/hello.test.mjs"
printf 'export const hello = () => "hello"\n' >"${TARGET}/src/hello.mjs"
(cd "$TARGET" && git add test src && git commit -q -m "feat: add hello")
set +e
check_out="$(cd "$TARGET" && SOLODEV_BASE=main "$SOLODEV" check hello --for implement 2>&1)"
check_rc=$?
set -e
assert_eq "$check_rc" "0" "solodev check --for implement passes a red-then-green journey"
assert_grep 'J1 red→green' "$check_out" "C3 proves the journey failed before the feature and passes now"
set +e
(cd "$TARGET" && SOLODEV_BASE=main "$SOLODEV" check hello --for pr >/dev/null 2>&1)
pr_rc=$?
set -e
assert_eq "$pr_rc" "1" "solodev check --for pr fails without a review"

# 9b. help, usage errors, and the package bin
assert_grep 'approve' "$("$SOLODEV" help)" "solodev help lists the commands"
assert_grep 'solodev check <slug>' "$(node "$INSTALL_JS" help check)" "package bin hands workflow commands to solodev"
set +e
(cd "$TARGET" && "$SOLODEV" check no-such-feature >/dev/null 2>&1)
usage_rc=$?
set -e
assert_eq "$usage_rc" "2" "solodev exits 2 on a usage error"

# 10. post-install next-step hints
hints="$(LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET" INSTALL_TARGET=claude node "$INSTALL_JS" 2>&1)"
assert_grep '/solodev-scout' "$hints" "suggests /solodev-scout"
if grep -qE 'brew install gh|gh is on PATH|cli.github.com' <<<"$hints"; then ok "suggests gh CLI"; else bad "missing gh CLI hint"; fi

# 11. missing dist fails (no client-side build)
EMPTY_SOURCE="${WORK}/empty-source"
mkdir -p "$EMPTY_SOURCE"
set +e
LOCAL_SOURCE="$EMPTY_SOURCE" TARGET_DIR="$TARGET" INSTALL_TARGET=all node "$INSTALL_JS" >/dev/null 2>&1
empty_rc=$?
set -e
if [[ $empty_rc -ne 0 ]]; then ok "installer fails when LOCAL_SOURCE has no dist/"; else bad "installer should fail without dist/"; fi

# 12. global install uses isolated leaves and does not clobber host config
FAKE_HOME="${WORK}/fake-home"
mkdir -p "${FAKE_HOME}/.cursor/agents" "${FAKE_HOME}/.claude" "${FAKE_HOME}/.codex"
printf '%s' "user-agent" >"${FAKE_HOME}/.cursor/agents/user-agent.md"
printf '%s' '{"keep":true}' >"${FAKE_HOME}/.claude/settings.json"
printf '%s' "# user config" >"${FAKE_HOME}/.codex/config.toml"
GLOBAL_TARGET="${WORK}/global-consumer"
mkdir -p "$GLOBAL_TARGET"
# CODEX_HOME may point elsewhere in the caller's shell (Orca sets it); the global codex leaf follows it.
HOME="$FAKE_HOME" CODEX_HOME="${FAKE_HOME}/.codex" INSTALL_SCOPE=global INSTALL_TARGET=all \
  LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$GLOBAL_TARGET" node "$INSTALL_JS" >/dev/null

assert_file_exists "${FAKE_HOME}/.agents/skills/solodev-mission/SKILL.md" "global skills land in ~/.agents"
assert_file_exists "${FAKE_HOME}/.agents/bin/solodev.mjs" "global solodev CLI lands in ~/.agents/bin"
assert_file_exists "${FAKE_HOME}/.cursor/agents/shadow-coder.md" "global cursor agents leaf"
assert_file_exists "${FAKE_HOME}/.cursor/agents/user-agent.md" "global install keeps planted cursor agent"
assert_file_exists "${FAKE_HOME}/.claude/agents/shadow-coder.md" "global claude agents leaf"
assert_file_exists "${FAKE_HOME}/.claude/skills/solodev-mission/SKILL.md" "global claude skills copy"
assert_file_exists "${FAKE_HOME}/.codex/agents/shadow-coder.toml" "global codex agents leaf"
assert_file_absent "${GLOBAL_TARGET}/.claude" "global install does not write claude into TARGET_DIR"
assert_file_absent "${GLOBAL_TARGET}/.agents" "global install does not write .agents into TARGET_DIR"
assert_eq "$(cat "${FAKE_HOME}/.claude/settings.json")" '{"keep":true}' "global install does not clobber claude settings.json"
assert_eq "$(cat "${FAKE_HOME}/.codex/config.toml")" "# user config" "global install does not clobber codex config.toml"

rm "${UPSTREAM}/dist/cursor/agents/shadow-reviewer.md"
HARNESS_ROOT="$UPSTREAM" node "${REPO_ROOT}/tools/gen-manifest.ts" >/dev/null
HOME="$FAKE_HOME" INSTALL_SCOPE=global INSTALL_TARGET=cursor \
  LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$GLOBAL_TARGET" node "$INSTALL_JS" >/dev/null
assert_file_absent "${FAKE_HOME}/.cursor/agents/shadow-reviewer.md" "global prune removes upstream-deleted cursor agent"
assert_file_exists "${FAKE_HOME}/.cursor/agents/user-agent.md" "global prune keeps planted non-solodev agent"
restore_upstream

# 13. a v1 OpenCode install is removed, file by file, from its own manifest
TARGET3="${WORK}/legacy-opencode"
mkdir -p "${TARGET3}/.opencode/agents"
(cd "$TARGET3" && git init -q)
echo "v1 conductor" >"${TARGET3}/.opencode/agents/arise.md"
echo "user agent" >"${TARGET3}/.opencode/agents/mine.md"
printf '%s  agents/arise.md\n' "$(shasum -a 256 "${TARGET3}/.opencode/agents/arise.md" | awk '{print $1}')" \
  >"${TARGET3}/.opencode/.harness-manifest"
legacy_out="$(LOCAL_SOURCE="$UPSTREAM" TARGET_DIR="$TARGET3" INSTALL_TARGET=claude node "$INSTALL_JS" 2>&1)"
assert_grep "delete    .opencode/agents/arise.md" "$legacy_out" "reports removal of the v1 OpenCode agent"
assert_file_absent "${TARGET3}/.opencode/agents/arise.md" "v1 OpenCode agent removed"
assert_file_absent "${TARGET3}/.opencode/.harness-manifest" "v1 OpenCode manifest removed"
assert_file_exists "${TARGET3}/.opencode/agents/mine.md" "user's own OpenCode file kept"

# bunx-equivalent: same bin/install.js under bun (consumers may still use bunx)
if ! command -v bun >/dev/null 2>&1; then
  ok "bun bin/install.js --doctor (skipped: bun not installed)"
elif TARGET_DIR="$TARGET" bun "$INSTALL_JS" --doctor >/dev/null 2>&1; then
  ok "bun bin/install.js --doctor exits 0"
else
  bad "bun bin/install.js --doctor should exit 0"
fi

echo ""
echo "${pass} passed, ${fail} failed"
[[ $fail -eq 0 ]]
