#!/usr/bin/env bash
# PRD 0027 PR B v2 step 12 (scope move, see report): bring the top-level src/ files (bootstrap-*, main, mainImpl, cli,
# server-*, tsconfig.*) to upstream when the fork never changed them since the fork point. Upstream src/vs 1.140
# is written against these entry points. A root file the fork did change is left alone and printed.
set -euo pipefail
W="${1:?worktree}"
U="${UPSTREAM:?set UPSTREAM to a vscode checkout at the reference commit (see README.md)}"
FORK="${FORK:-$W}" # any clone of the fork that has FORK_REF; the worktree itself works
REF="${FORK_REF:-1feddc94420}"
UREF="${UPSTREAM_REF:-1.146.0}"
FP="${FORK_PREV_REF:-45a4c6d6ddc}"   # fork-side commit of the previous sync (PR #464 merge); upstream commits are not in the fork history
for f in $(git -C "$U" ls-tree --name-only "$UREF" src/ | grep -v '^src/vs$' | grep -v '^src/vscode-dts$'); do
	if [ -d "$U/$f" ]; then kind=dir; else kind=file; fi
	if [ -n "$(git -C "$FORK" log --oneline "$FP..$REF" -- "$f")" ]; then echo "fork-touched, left: $f"; continue; fi
	rm -rf "$W/$f"; git -C "$U" archive "$UREF" "$f" | tar -x -C "$W"
done
echo "12 done"
