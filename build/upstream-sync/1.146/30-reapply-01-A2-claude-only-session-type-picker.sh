#!/usr/bin/env bash
# PRD 0017 v2: ra: A2 claude-only-session-type-picker (spike commit 3a0c560ca92). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-01-A2-claude-only-session-type-picker.patch"
