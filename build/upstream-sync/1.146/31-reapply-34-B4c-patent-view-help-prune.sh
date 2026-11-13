#!/usr/bin/env bash
# PRD 0017 v2: ra: B4c patent-view-help-prune (spike commit 1362a1e468a). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-34-B4c-patent-view-help-prune.patch"
