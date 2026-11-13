#!/usr/bin/env bash
# PRD 0017 v2: ra: B5b patent-input-placeholders (spike commit 86882f21726). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-37-B5b-patent-input-placeholders.patch"
