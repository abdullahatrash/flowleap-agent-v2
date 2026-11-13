#!/usr/bin/env bash
# PRD 0017 v2: ra: A12 claude-permission-mode-picker (spike commit ab8c2c9408a). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-02-A12-claude-permission-mode-picker.patch"
