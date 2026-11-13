#!/usr/bin/env bash
# PRD 0027 PR B: A5.3 — locked-agent input placeholder speaks the patent voice (chat half of 03800aba03c). Applies patches/31-reapply-52-A5.3-locked-agent-patent-placeholder.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-52-A5.3-locked-agent-patent-placeholder.patch"
