#!/usr/bin/env bash
# PRD 0027 PR B: B8b — hide developer surfaces for new users. Applies patches/31-reapply-16-B8b-hide-developer-surfaces-for-new-users.patch (written against upstream 69047191fc4 = 1.146.0 after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-16-B8b-hide-developer-surfaces-for-new-users.patch"
