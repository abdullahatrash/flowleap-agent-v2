#!/usr/bin/env bash
# PRD 0027 PR B: B12 — patent client tool set for agent-host sessions. Applies patches/31-reapply-48-B12-patent-tool-sets.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-48-B12-patent-tool-sets.patch"
