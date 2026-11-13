#!/usr/bin/env bash
# PRD 0027 PR B: B1 — onboarding wizard and walkthrough. Applies patches/31-reapply-14-B1-onboarding-wizard-and-walkthrough.patch (written against upstream 69047191fc4 = 1.146.0 after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-14-B1-onboarding-wizard-and-walkthrough.patch"
