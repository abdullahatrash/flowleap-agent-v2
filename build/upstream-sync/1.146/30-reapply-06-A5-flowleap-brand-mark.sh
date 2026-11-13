#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-06-A5-flowleap-brand-mark. Applies patches/30-reapply-06-A5-flowleap-brand-mark.patch (written against upstream 1.146.0 after step 10-13).
# Applied as-is at 1.146.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-06-A5-flowleap-brand-mark.patch"
