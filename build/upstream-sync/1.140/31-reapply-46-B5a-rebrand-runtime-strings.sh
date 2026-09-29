#!/usr/bin/env bash
# PRD 0017 v2: ra: B5a rebrand-runtime-strings (setup footer, permission warning, models sign-in) (spike commit ba45b22c892). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-46-B5a-rebrand-runtime-strings.patch"
