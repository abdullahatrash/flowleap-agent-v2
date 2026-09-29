#!/usr/bin/env bash
# PRD 0017 v2: ra: B4b patent-menubar-gates (spike commit 6cb1bdf3531). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-33-B4b-patent-menubar-gates.patch"
