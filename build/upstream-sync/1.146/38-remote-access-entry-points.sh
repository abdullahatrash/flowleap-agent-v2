#!/usr/bin/env bash
# PRD 0027 PR B: 38-remote-access-entry-points. Applies patches/38-remote-access-entry-points.patch (written against upstream 1.146.0 after step 10-13).
# New intent (PRD 0018 C, #481): the Agents Window desktop entry imports the Remote Access contributions (files owned by the agenthost group, carried by step 10).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/38-remote-access-entry-points.patch"
