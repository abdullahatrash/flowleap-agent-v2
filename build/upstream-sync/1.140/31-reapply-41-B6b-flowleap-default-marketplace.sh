#!/usr/bin/env bash
# PRD 0017 v2: ra: B6b flowleap-default-marketplace (spike commit 2d4248d5a8d). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-41-B6b-flowleap-default-marketplace.patch"
