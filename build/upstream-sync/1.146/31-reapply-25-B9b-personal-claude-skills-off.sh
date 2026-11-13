#!/usr/bin/env bash
# PRD 0017 v2: ra: B9b personal-claude-skills-off (spike commit c00c030dea5). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-25-B9b-personal-claude-skills-off.patch"
