#!/usr/bin/env bash
# PRD 0017 v2: ra: B10c add-context-files-from-disk (spike commit 7a1df31f542). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-29-B10c-add-context-files-from-disk.patch"
