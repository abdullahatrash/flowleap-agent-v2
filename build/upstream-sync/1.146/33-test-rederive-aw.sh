#!/usr/bin/env bash
# PRD 0027 PR B: 33-test-rederive-aw. Applies patches/33-test-rederive-aw.patch (written against upstream 1.146.0 after step 10-13).
# Tests in the aw paths; the 1.140 33-test-rederive patch also holds chat-group files and is left for the lead.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/33-test-rederive-aw.patch"
