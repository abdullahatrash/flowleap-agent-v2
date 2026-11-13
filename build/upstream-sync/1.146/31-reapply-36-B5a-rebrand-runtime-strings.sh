#!/usr/bin/env bash
# PRD 0027 PR B: B5a — rebrand the user-reachable Copilot strings by nls key (replaces the 1.140 patches
# 31-reapply-36, 31-reapply-46 and 37-d7, whose string table is tools/rebrand-strings.json).
# Runs tools/rebrand-strings.mjs: a key whose literal still equals the 1.140 text is rewritten; a reworded
# key is printed as REWORDED for a hand decision (same voice: "GitHub Copilot"/"Copilot" -> "FlowLeap",
# Copilot CLI session type -> "CLI Agent", "{0} Copilot" -> "{0}", Copilot harness -> "the agent host").
# Pass --skip <prefix> to leave another group's files alone (the brand group ran it with
# --skip src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts --skip src/vs/sessions/ --skip src/vs/platform/agentHost/).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="${1:?worktree}"; shift
node "$HERE/tools/rebrand-strings.mjs" "$W" "$@"
