#!/usr/bin/env bash
# PRD 0017 v2: ra: A9 workflow-template-starters (spike commit 82be7d01e58). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-08-A9-workflow-template-starters.patch"
