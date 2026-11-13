#!/usr/bin/env bash
# PRD 0017 v2: ra: B9a claude-md-off-by-default (spike commit a09c2e9a79d). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-24-B9a-claude-md-off-by-default.patch"
