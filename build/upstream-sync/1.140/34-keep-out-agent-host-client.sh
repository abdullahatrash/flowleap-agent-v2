#!/usr/bin/env bash
# PRD 0017 v2: 34-keep-out-agent-host-client. Applies patches/34-keep-out-agent-host-client.patch (written against upstream 480c6e142fa after step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/34-keep-out-agent-host-client.patch"
