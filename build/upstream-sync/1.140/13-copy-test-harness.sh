#!/usr/bin/env bash
# PRD 0017 v2 step 13 (scope move, see report): the unit-test harness under test/unit runs upstream src/vs tests
# (e.g. ProtocolMainService needs the 'vscode:test-remote-resource' handler + fixtures). The fork never changed
# test/unit since the fork point, so it is replaced by upstream's; refuses if the fork did change it.
set -euo pipefail
W="${1:?worktree}"
U="${UPSTREAM:?set UPSTREAM to a vscode checkout at the reference commit (see README.md)}"
FORK="${FORK:-$W}" # any clone of the fork that has FORK_REF; the worktree itself works
REF="${FORK_REF:-810ad70ca59}"
if [ -n "$(git -C "$FORK" log --oneline b0b6062a94664d83022ccc705c0f68ee259de768.."$REF" -- test/unit)" ]; then echo "fork changed test/unit; re-apply by hand" >&2; exit 1; fi
rm -rf "$W/test/unit"; git -C "$U" archive HEAD test/unit | tar -x -C "$W"
echo "13 done"
