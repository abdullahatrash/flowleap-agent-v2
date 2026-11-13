#!/usr/bin/env bash
# PRD 0027 PR B: B6d — MCP server context menu drops self-hidden actions. Applies patches/31-reapply-43-B6d-mcp-list-action-state.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-43-B6d-mcp-list-action-state.patch"
