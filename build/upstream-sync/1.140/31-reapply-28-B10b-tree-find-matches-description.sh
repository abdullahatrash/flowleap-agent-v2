#!/usr/bin/env bash
# PRD 0017 v2: ra: B10b tree-find-matches-description (spike commit 82dbfb980f8). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-28-B10b-tree-find-matches-description.patch"
