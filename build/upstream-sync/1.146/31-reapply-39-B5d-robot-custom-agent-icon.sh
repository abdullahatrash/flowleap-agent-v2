#!/usr/bin/env bash
# PRD 0027 PR B: B5d — robot custom agent icon. Applies patches/31-reapply-39-B5d-robot-custom-agent-icon.patch (written against upstream 69047191fc4 = 1.146.0 after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-39-B5d-robot-custom-agent-icon.patch"
