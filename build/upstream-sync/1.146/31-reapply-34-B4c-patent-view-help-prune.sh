#!/usr/bin/env bash
# PRD 0027 PR B: B4c — patent view/help prune (the Extensions View-menu gate lives in 31-reapply-32-B4a, same descriptor). Applies patches/31-reapply-34-B4c-patent-view-help-prune.patch (written against upstream 69047191fc4 = 1.146.0 after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-34-B4c-patent-view-help-prune.patch"
