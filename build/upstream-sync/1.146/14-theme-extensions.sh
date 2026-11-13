#!/usr/bin/env bash
# PRD 0027 PR B step 14: the built-in colour themes (extensions/theme-*) carry no fork intent and two 1.146
# tests read them from disk; copy them from upstream wholesale.
# Usage: 14-theme-extensions.sh <worktree>   (env: UPSTREAM, UPSTREAM_REF)
set -euo pipefail
W="${1:?worktree}"
U="${UPSTREAM:?set UPSTREAM to a vscode checkout that has UPSTREAM_REF (see README.md)}"
UREF="${UPSTREAM_REF:-1.146.0}"
for d in $(git -C "$U" ls-tree --name-only "$UREF" extensions/ | grep '^extensions/theme-'); do
	rm -rf "$W/$d"; git -C "$U" archive "$UREF" "$d" | tar -x -C "$W"
done
echo "14 done"
