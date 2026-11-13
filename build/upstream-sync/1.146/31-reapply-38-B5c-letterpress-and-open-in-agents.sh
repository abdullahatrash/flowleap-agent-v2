#!/usr/bin/env bash
# PRD 0017 v2: ra: B5c letterpress-and-open-in-agents (spike commit 3b5063aa064). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-38-B5c-letterpress-and-open-in-agents.patch"
