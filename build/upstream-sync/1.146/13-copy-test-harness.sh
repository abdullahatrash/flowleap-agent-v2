#!/usr/bin/env bash
# PRD 0027 PR B v2 step 13 (scope move, see report): the unit-test harness under test/unit runs upstream src/vs tests
# (e.g. ProtocolMainService needs the 'vscode:test-remote-resource' handler + fixtures). The fork never changed
# test/unit since the fork point, so it is replaced by upstream's; refuses if the fork did change it.
set -euo pipefail
W="${1:?worktree}"
U="${UPSTREAM:?set UPSTREAM to a vscode checkout at the reference commit (see README.md)}"
FORK="${FORK:-$W}" # any clone of the fork that has FORK_REF; the worktree itself works
REF="${FORK_REF:-1feddc94420}"
UREF="${UPSTREAM_REF:-1.146.0}"
FP="${FORK_PREV_REF:-45a4c6d6ddc}"   # fork-side commit of the previous sync (PR #464 merge); upstream commits are not in the fork history
if [ -n "$(git -C "$FORK" log --oneline "$FP".."$REF" -- test/unit ":!test/unit/package.json")" ]; then echo "fork changed test/unit; re-apply by hand" >&2; exit 1; fi
rm -rf "$W/test/unit"; git -C "$U" archive "$UREF" test/unit | tar -x -C "$W"
echo "13 done"
