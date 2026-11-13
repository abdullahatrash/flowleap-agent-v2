#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-01-A2-claude-only-session-type-picker. Applies patches/30-reapply-01-A2-claude-only-session-type-picker.patch (written against upstream 1.146.0 after step 10-13).
# Re-derived: the 1.140 fork-only provider is gone (PRD 0018); the picker gate lives in the agent host (agenthost group). This file flips chat.defaultToCopilotHarness and chat.editor.preferCopilotHarness back to false (upstream 186e3338383 made them true).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-01-A2-claude-only-session-type-picker.patch"
