#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-05-A3-account-panel-flowleap-auth. Applies patches/30-reapply-05-A3-account-panel-flowleap-auth.patch (written against upstream 1.146.0 after step 10-13).
# Re-anchored at 1.146 (8 files at the same paths) plus the auth-UI follow-up 79d70f0ab53 and the B5a strings in sessionTypeAvailability.ts.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-05-A3-account-panel-flowleap-auth.patch"
