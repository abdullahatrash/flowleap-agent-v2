#!/usr/bin/env bash
# PRD 0017 v2: ra: B8a light-2026-default-native-chrome-follows-theme (spike commit 6c2ff72f2b6). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-15-B8a-light-2026-default-native-chrome-follows-theme.patch"
