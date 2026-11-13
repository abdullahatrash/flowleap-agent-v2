#!/usr/bin/env bash
# PRD 0027 PR B: 36-kept-out-contrib-services. Applies patches/36-kept-out-contrib-services.patch (written against upstream 1.146.0 after step 10-13; re-points the fork-only file carried by step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/36-kept-out-contrib-services.patch"
