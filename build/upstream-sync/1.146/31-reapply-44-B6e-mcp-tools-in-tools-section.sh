#!/usr/bin/env bash
# PRD 0017 v2: ra: B6e mcp-tools-in-tools-section (spike commit 4a92413fe14). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-44-B6e-mcp-tools-in-tools-section.patch"
