#!/usr/bin/env bash
# PRD 0017 v2: ra: B4a patent-context-key (spike commit 917066a781d). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-32-B4a-patent-context-key.patch"
