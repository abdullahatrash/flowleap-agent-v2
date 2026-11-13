#!/usr/bin/env bash
# PRD 0017 v2: ra: B6d mcp-list-action-state (spike commit 6f9e8d54067). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-43-B6d-mcp-list-action-state.patch"
