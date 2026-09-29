#!/usr/bin/env bash
# PRD 0017 v2: 32-integration. Applies patches/32-integration.patch (written against upstream 480c6e142fa after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/32-integration.patch"
