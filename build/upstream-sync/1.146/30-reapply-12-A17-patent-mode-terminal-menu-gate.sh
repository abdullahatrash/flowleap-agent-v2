#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-12-A17-patent-mode-terminal-menu-gate. Applies patches/30-reapply-12-A17-patent-mode-terminal-menu-gate.patch (written against upstream 1.146.0 after step 10-13).
# Re-anchored (context drift only).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-12-A17-patent-mode-terminal-menu-gate.patch"
