#!/usr/bin/env bash
# PRD 0017 v2: ra: A6 patent-voice-strings (spike commit 14dbd553c21). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-07-A6-patent-voice-strings.patch"
