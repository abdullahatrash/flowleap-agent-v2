#!/usr/bin/env bash
# PRD 0017 v2: ra: B2 flowleap-sign-in-only (spike commit fa15784c75d). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-13-B2-flowleap-sign-in-only.patch"
