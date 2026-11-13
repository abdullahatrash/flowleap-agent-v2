#!/usr/bin/env bash
# PRD 0027 PR B: B13 — native Mistral BYOK vendor id known to core. Applies patches/31-reapply-49-B13-mistral-provider.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-49-B13-mistral-provider.patch"
