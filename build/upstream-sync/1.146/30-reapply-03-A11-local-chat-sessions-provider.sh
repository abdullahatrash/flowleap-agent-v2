#!/usr/bin/env bash
# PRD 0017 v2: ra: A11 local-chat-sessions-provider (spike commit 49fa49b182a). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-03-A11-local-chat-sessions-provider.patch"
