#!/usr/bin/env bash
# PRD 0027 PR B: 20-keep-out. Applies patches/20-keep-out.patch (written against upstream 1.146.0 after step 10-13).
# Unregisters, never deletes: GitHub, codeReview, automations, remote agent hosts, tunnels, cloud sandboxes,
# Mission Control, Inbox One canvas host, Computer Use helper app, Codex continuation, chat input spotlight tour,
# model picker tryout; adds the kept-out remote agent host services file core still injects.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/20-keep-out.patch"
