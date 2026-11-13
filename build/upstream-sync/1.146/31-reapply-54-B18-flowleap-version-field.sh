#!/usr/bin/env bash
# PRD 0027 PR B: B18 — flowleapVersion product field. Applies patches/31-reapply-54-B18-flowleap-version-field.patch (written against upstream 69047191fc4 = 1.146.0 after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-54-B18-flowleap-version-field.patch"
