#!/usr/bin/env bash
# PRD 0027 PR B: B6b — FlowLeap default plugin marketplace, pre-trusted; marketplace opens on Plugins. Applies patches/31-reapply-41-B6b-flowleap-default-marketplace.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-41-B6b-flowleap-default-marketplace.patch"
