#!/usr/bin/env bash
# PRD 0017 v2: ra: B3a byok-nudge (spike commit 30e8aecb5ef). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-19-B3a-byok-nudge.patch"
