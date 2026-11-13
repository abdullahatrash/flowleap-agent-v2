#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-10-A13-mcp-inputs-and-tools-count. Applies patches/30-reapply-10-A13-mcp-inputs-and-tools-count.patch (written against upstream 1.146.0 after step 10-13).
# Re-anchored: the userConfiguration.reload() seam and its test; the Tools count consumers now use upstream's getCustomizationToolSets (d7d2fd6929d), subsumed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-10-A13-mcp-inputs-and-tools-count.patch"
