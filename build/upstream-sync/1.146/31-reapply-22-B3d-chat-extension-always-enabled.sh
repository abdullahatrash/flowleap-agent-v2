#!/usr/bin/env bash
# PRD 0017 v2: ra: B3d chat-extension-always-enabled (spike commit 60e94337fff). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-22-B3d-chat-extension-always-enabled.patch"
