#!/usr/bin/env bash
# PRD 0017 v2: ra: B6a mcp-gallery-flowleap-registry (merge duplicate import) (spike commit 9bb2b8f06b5). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-45-B6a-mcp-gallery-flowleap-registry.patch"
