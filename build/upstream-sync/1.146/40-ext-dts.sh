#!/usr/bin/env bash
# PRD 0027 PR B: ext-dts — chatParticipantAdditions dts carries agentDisplayName (extension compiles against 1.146). Applies patches/40-ext-dts.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/40-ext-dts.patch"
