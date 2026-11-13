#!/usr/bin/env bash
# PRD 0027 PR B: B10d — chat output block ignores zero webview height. Applies patches/31-reapply-30-B10d-chat-output-zero-height.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-30-B10d-chat-output-zero-height.patch"
