#!/usr/bin/env bash
# PRD 0027 PR B: B3a — BYOK nudge in the empty chat welcome. Applies patches/31-reapply-19-B3a-byok-nudge.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-19-B3a-byok-nudge.patch"
