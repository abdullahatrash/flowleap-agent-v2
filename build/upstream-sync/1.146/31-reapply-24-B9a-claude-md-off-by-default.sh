#!/usr/bin/env bash
# PRD 0027 PR B: 31-reapply-24-B9a-claude-md-off-by-default. Applies patches/31-reapply-24-B9a-claude-md-off-by-default.patch (written against upstream 1.146.0 after step 10-13).
# Chat-group intent in an aw-owned file (chat.shared.contribution.ts); re-anchored.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-24-B9a-claude-md-off-by-default.patch"
