#!/usr/bin/env bash
# PRD 0017 v2: ra: B3e no-model-way-out (spike commit d6db688d6ad). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-23-B3e-no-model-way-out.patch"
