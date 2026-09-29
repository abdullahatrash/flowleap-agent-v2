#!/usr/bin/env bash
# PRD 0017 v2: ra: B8c command-palette-activity-bar-icon (spike commit 18ce2fb7412). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-17-B8c-command-palette-activity-bar-icon.patch"
