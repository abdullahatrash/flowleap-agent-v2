#!/usr/bin/env bash
# PRD 0027 PR B: B14 — hosted user MCP server listed once; gallery installs go to the remote from the web client (#593). Applies patches/31-reapply-50-B14-mcp-hosted.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-50-B14-mcp-hosted.patch"
