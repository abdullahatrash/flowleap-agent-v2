#!/usr/bin/env bash
# PRD 0027 PR B: 42-aw-rebrand-agent-sessions-configuration. Applies patches/42-aw-rebrand-agent-sessions-configuration.patch (written against upstream 1.146.0 after step 10-13).
# Rebrand strings the brand sweep skipped in an aw-owned file (5 keys).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/42-aw-rebrand-agent-sessions-configuration.patch"
