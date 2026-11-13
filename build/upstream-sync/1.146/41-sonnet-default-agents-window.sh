#!/usr/bin/env bash
# PRD 0027 PR B: 41-sonnet-default-agents-window. Applies patches/41-sonnet-default-agents-window.patch (written against upstream 1.146.0 after step 10-13).
# New intent (fork commit 2a864555392): findRecommendedDefaultModel is gone at 1.146; a local newest-Sonnet helper feeds getDeclaredDefaultModel. The lead may re-point it to the chat group's B9c helper at integration.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/41-sonnet-default-agents-window.patch"
