#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-14-A19-ahp-log-metadata-only. Re-applies PRD 0018 A4: every AhpJsonlLogger projects frames to metadata unless content: 'full'; developer setting chat.agentHost.ahpJsonlLoggingIncludeContent (registered next to ahpJsonlLogging in agentHostStarter.config.contribution.ts); Claude mapper trace logs metadata; Export Agent Host Debug Logs warns when the export holds content; upstream tests ask for content: 'full'. Applies patches/30-reapply-14-A19-ahp-log-metadata-only.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-14-A19-ahp-log-metadata-only.patch"
