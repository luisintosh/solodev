#!/usr/bin/env bash
# The held-out acceptance test, which the coder never saw, passes on the code committed at HEAD.
set -u
stage=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp" >/dev/null 2>&1; rm -rf "$tmp"' EXIT
git worktree add -q --detach "$tmp" HEAD
cp "$stage/accept/greet.accept.test.mjs" "$tmp/"
cd "$tmp" && node --test greet.accept.test.mjs
