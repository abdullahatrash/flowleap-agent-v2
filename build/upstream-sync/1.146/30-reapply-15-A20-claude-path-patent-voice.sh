#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-15-A20-claude-path-patent-voice. Re-applies PRD 0018 A5.3 on the agent host side: Claude ExitPlanMode reads 'Approve the plan?' (display name + confirmation title) with its tests. The chat-side half (locked-agent placeholder in chatWidget.ts, patentInputPlaceholder.ts) belongs to the chat group. Applies patches/30-reapply-15-A20-claude-path-patent-voice.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-15-A20-claude-path-patent-voice.patch"
