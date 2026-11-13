#!/usr/bin/env bash
# PRD 0027 PR B: B6a — MCP gallery = FlowLeap registry (negotiated v0, Learn-more link). Applies patches/31-reapply-40-B6a-mcp-gallery-flowleap-registry.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-40-B6a-mcp-gallery-flowleap-registry.patch"
