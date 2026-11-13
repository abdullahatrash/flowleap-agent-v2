#!/usr/bin/env bash
# PRD 0027 PR B: B10a — subagent header display name on the ext-host path. Applies patches/31-reapply-27-B10a-subagent-header-ext-host.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-27-B10a-subagent-header-ext-host.patch"
