#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-09-A10-flowleap-cli-nudge. Applies patches/30-reapply-09-A10-flowleap-cli-nudge.patch (written against upstream 1.146.0 after step 10-13).
# Re-anchored: entry-point lines plus the fork-only contribution's imports re-pointed to workbench/contrib/sessions.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-09-A10-flowleap-cli-nudge.patch"
