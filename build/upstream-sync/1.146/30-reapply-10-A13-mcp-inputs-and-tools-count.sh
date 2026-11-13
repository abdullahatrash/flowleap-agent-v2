#!/usr/bin/env bash
# PRD 0017 v2: ra: A13 mcp-inputs-and-tools-count (spike commit a6136539fb9). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-10-A13-mcp-inputs-and-tools-count.patch"
