#!/usr/bin/env bash
# PRD 0017: package upstream's mainImpl entry in build/ (fork-owned files; already applied on this branch). Applies patches/42-build-mainimpl-entry.patch.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/42-build-mainimpl-entry.patch"
