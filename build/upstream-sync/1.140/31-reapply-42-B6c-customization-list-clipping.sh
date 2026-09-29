#!/usr/bin/env bash
# PRD 0017 v2: ra: B6c customization-list-clipping (spike commit 467d3f6cc54). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-42-B6c-customization-list-clipping.patch"
