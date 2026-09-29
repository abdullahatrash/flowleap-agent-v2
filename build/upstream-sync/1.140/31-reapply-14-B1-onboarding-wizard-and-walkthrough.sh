#!/usr/bin/env bash
# PRD 0017 v2: ra: B1 onboarding-wizard-and-walkthrough (spike commit e164e176bba). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-14-B1-onboarding-wizard-and-walkthrough.patch"
