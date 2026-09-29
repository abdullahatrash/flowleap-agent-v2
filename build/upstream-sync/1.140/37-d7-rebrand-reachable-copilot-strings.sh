#!/usr/bin/env bash
# PRD 0017: D7: rebrand the Copilot strings a user can reach in registered surfaces. Applies patches/37-d7-rebrand-reachable-copilot-strings.patch.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/37-d7-rebrand-reachable-copilot-strings.patch"
