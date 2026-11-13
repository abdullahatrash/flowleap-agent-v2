#!/usr/bin/env bash
# PRD 0027 PR B: 20b-keep-out-codex-continuation-editor. Applies patches/20b-keep-out-codex-continuation-editor.patch (written against upstream 1.146.0 after step 10-13).
# Keep-out of the editor-side Codex-to-Copilot continuation contribution; Computer Use setup stays registered because the agent host session handler injects its service.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/20b-keep-out-codex-continuation-editor.patch"
