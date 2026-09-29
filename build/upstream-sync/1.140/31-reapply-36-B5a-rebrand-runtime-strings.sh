#!/usr/bin/env bash
# PRD 0017 v2: ra: B5a rebrand-runtime-strings (spike commit 638b1bb3f05). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-36-B5a-rebrand-runtime-strings.patch"
