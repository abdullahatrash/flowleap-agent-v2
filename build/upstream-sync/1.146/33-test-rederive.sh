#!/usr/bin/env bash
# PRD 0027 PR B: test-rederive — chat tests re-derived for the FlowLeap strings (chatSetup, sessionTargetPicker). Applies patches/33-test-rederive.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/33-test-rederive.patch"
