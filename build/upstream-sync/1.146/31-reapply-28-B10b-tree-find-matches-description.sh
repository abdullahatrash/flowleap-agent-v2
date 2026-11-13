#!/usr/bin/env bash
# PRD 0027 PR B: B10b — tree type-to-find matches the description. Applies patches/31-reapply-28-B10b-tree-find-matches-description.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-28-B10b-tree-find-matches-description.patch"
