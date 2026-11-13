#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-13-A18-claude-only-agent-host. Re-applies PRD 0018 A3.1–A3.5 (Copilot agent never starts, Codex hidden by default, keychain claude.ai login counts as set up, GitHub auth log at trace, decision #59 spawn-env guardrail). Applies patches/30-reapply-13-A18-claude-only-agent-host.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-13-A18-claude-only-agent-host.patch"
