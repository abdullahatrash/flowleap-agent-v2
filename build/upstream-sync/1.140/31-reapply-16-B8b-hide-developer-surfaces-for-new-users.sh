#!/usr/bin/env bash
# PRD 0017 v2: ra: B8b hide-developer-surfaces-for-new-users (spike commit d483977b92b). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-16-B8b-hide-developer-surfaces-for-new-users.patch"
