#!/usr/bin/env bash
# PRD 0027 PR B: 40-remote-access-viewer-entry. Applies patches/40-remote-access-viewer-entry.patch (written against upstream 1.146.0 after step 10-13).
# New intent (fork commit 26405920eb4): fork-only sessions.viewer.main.ts re-pointed to the .contribution.js homes; the agent picker the 1.140 Viewer imported is back.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/40-remote-access-viewer-entry.patch"
