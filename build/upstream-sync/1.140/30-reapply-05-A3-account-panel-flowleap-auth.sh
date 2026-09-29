#!/usr/bin/env bash
# PRD 0017 v2: ra: A3 account-panel-flowleap-auth (spike commit bbf5543d59d). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-05-A3-account-panel-flowleap-auth.patch"
