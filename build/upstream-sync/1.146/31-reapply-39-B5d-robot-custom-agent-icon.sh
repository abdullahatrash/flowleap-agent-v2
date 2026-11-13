#!/usr/bin/env bash
# PRD 0017 v2: ra: B5d robot-custom-agent-icon (spike commit 603d59a2b1f). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-39-B5d-robot-custom-agent-icon.patch"
