#!/usr/bin/env bash
# PRD 0017 v2: ra: B3c per-model-token-totals (spike commit cecbdcfec20). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-21-B3c-per-model-token-totals.patch"
