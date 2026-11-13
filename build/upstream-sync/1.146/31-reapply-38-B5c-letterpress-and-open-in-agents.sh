#!/usr/bin/env bash
# PRD 0027 PR B: B5c — letterpress and Open in Agents. Applies patches/31-reapply-38-B5c-letterpress-and-open-in-agents.patch (written against upstream 69047191fc4 = 1.146.0 after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-38-B5c-letterpress-and-open-in-agents.patch"
