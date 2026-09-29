#!/usr/bin/env bash
# PRD 0017: replay the whole 1.140 sync on a worktree checked out at the base commit (see README.md).
# Usage: UPSTREAM=<vscode checkout at the reference commit> ./run-all.sh <worktree>
# Needs a real (not symlinked) node_modules for step 11 and fontforge for step 41.
set -euo pipefail
W="${1:?worktree}"; HERE="$(cd "$(dirname "$0")" && pwd)"
: "${UPSTREAM:?set UPSTREAM to a vscode checkout at the reference commit}"
"$HERE/10-copy-src-vs.sh" "$W"
"$HERE/11-npm-deps.sh" "$W"
"$HERE/12-copy-src-root.sh" "$W"
"$HERE/13-copy-test-harness.sh" "$W"
"$HERE/20-keep-out.sh" "$W"
for s in "$HERE"/30-reapply-*.sh "$HERE"/31-reapply-*.sh; do "$s" "$W"; done
for s in 32-integration 33-test-rederive 34-keep-out-agent-host-client 35-local-harness-no-di-cycle 36-kept-out-contrib-services 37-d7-rebrand-reachable-copilot-strings 40-ext-dts 41-brand-codicon-font 42-build-mainimpl-entry; do
	"$HERE/$s.sh" "$W"
done
echo "run-all done"
