#!/usr/bin/env bash
# PRD 0017 v2: ra: A1 no-github-gate-welcome (spike commit e9f0c3458b3). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-04-A1-no-github-gate-welcome.patch"
