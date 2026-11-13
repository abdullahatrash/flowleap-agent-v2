#!/usr/bin/env bash
# PRD 0027 PR B: B3e — no-model way out: BYOK never routes to Copilot setup, picker placeholder + send gate. Applies patches/31-reapply-23-B3e-no-model-way-out.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-23-B3e-no-model-way-out.patch"
