#!/usr/bin/env bash
# PRD 0017 v2: ra: B4d custom-agent-icon (spike commit 3615991bd90). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-35-B4d-custom-agent-icon.patch"
