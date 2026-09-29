#!/usr/bin/env bash
# PRD 0017 v2: ra: B1b flowleap-cli-main-service (spike commit 0894b72e8f9). Intent re-applied against upstream 480c6e142fa.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-18-B1b-flowleap-cli-main-service.patch"
