#!/usr/bin/env bash
# PRD 0017 v2: ra: A5 flowleap-brand-mark (spike commit 3ec7bd468ee). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-06-A5-flowleap-brand-mark.patch"
