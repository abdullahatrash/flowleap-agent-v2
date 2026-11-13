#!/usr/bin/env bash
# PRD 0027 PR B: B8a — Light 2026 default + native chrome follows theme. Applies patches/31-reapply-15-B8a-light-2026-default-native-chrome-follows-theme.patch (written against upstream 69047191fc4 = 1.146.0 after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-15-B8a-light-2026-default-native-chrome-follows-theme.patch"
