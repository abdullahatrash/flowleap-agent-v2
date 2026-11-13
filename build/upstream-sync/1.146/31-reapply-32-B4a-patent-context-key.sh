#!/usr/bin/env bash
# PRD 0027 PR B: B4a — patent context key. Applies patches/31-reapply-32-B4a-patent-context-key.patch (written against upstream 69047191fc4 = 1.146.0 after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-32-B4a-patent-context-key.patch"
