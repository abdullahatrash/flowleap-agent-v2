#!/usr/bin/env bash
# PRD 0017 v2: ra: B3b byok-rejected-key (spike commit 9208c751e04). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-20-B3b-byok-rejected-key.patch"
