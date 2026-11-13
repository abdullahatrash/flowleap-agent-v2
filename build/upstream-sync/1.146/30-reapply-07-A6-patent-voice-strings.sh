#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-07-A6-patent-voice-strings. Applies patches/30-reapply-07-A6-patent-voice-strings.patch (written against upstream 1.146.0 after step 10-13).
# Re-derived: newChatInput.ts is gone (d1755aab64f); the placeholders live in newChatComposerInput.ts of the unified composer. The agentHostSchema/agentHostStarter string hunks belong to the agenthost group (reported).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-07-A6-patent-voice-strings.patch"
