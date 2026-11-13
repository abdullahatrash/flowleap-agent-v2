#!/usr/bin/env bash
# PRD 0017 v2: 36-kept-out-contrib-services. Applies patches/36-kept-out-contrib-services.patch (written against upstream 480c6e142fa after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/36-kept-out-contrib-services.patch"
