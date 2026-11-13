#!/usr/bin/env bash
# PRD 0027 PR B: B11 — load skills, instructions, prompts and agents from .flowleap/ and ~/.flowleap/ (#577). Applies patches/31-reapply-47-B11-flowleap-prompt-roots.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-47-B11-flowleap-prompt-roots.patch"
