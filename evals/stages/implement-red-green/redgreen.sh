#!/usr/bin/env bash
# The test files the branch added or changed since the base fail on the base's source and pass at HEAD.
set -u
base=$1
tests=$(git diff --name-only --diff-filter=AM "$base" HEAD | grep -E '\.test\.[cm]?[jt]s$' || true)
[ -n "$tests" ] || { echo "no test file committed since the base"; exit 1; }
tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp" >/dev/null 2>&1; rm -rf "$tmp"' EXIT
git worktree add -q --detach "$tmp" "$base"
ln -s "$PWD/node_modules" "$tmp/node_modules"
for t in $tests; do
  mkdir -p "$tmp/$(dirname "$t")"
  git show "HEAD:$t" >"$tmp/$t"
done
# shellcheck disable=SC2086 # one argument per test file
if (cd "$tmp" && npx vitest run $tests >/dev/null 2>&1); then
  echo "red: the tests pass on the base, so they prove nothing"
  exit 1
fi
# shellcheck disable=SC2086
npx vitest run $tests >/dev/null 2>&1 || { echo "green: the tests fail at HEAD"; exit 1; }
echo "red on the base, green at HEAD: ${tests//$'\n'/ }"
