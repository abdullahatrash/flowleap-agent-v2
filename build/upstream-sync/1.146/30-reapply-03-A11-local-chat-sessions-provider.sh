#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-03-A11-local-chat-sessions-provider. Applies patches/30-reapply-03-A11-local-chat-sessions-provider.patch (written against upstream 1.146.0 after step 10-13).
# Re-anchored: fork-only provider carried by step 10; imports re-pointed to workbench/contrib/sessions, pickers read ISessionHost (ISessionContext is gone), the Local harness is registered by this contribution (35).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-03-A11-local-chat-sessions-provider.patch"
