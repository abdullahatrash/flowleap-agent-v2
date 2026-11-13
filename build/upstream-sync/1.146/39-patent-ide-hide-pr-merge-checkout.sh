#!/usr/bin/env bash
# PRD 0027 PR B: 39-patent-ide-hide-pr-merge-checkout. Applies patches/39-patent-ide-hide-pr-merge-checkout.patch (written against upstream 1.146.0 after step 10-13).
# New intent (fork commit 475ee1067ca): patentChangesetOperations.ts moves to workbench/contrib/sessionChanges/common so the moved Changes view may import it; the title operations filter is a parameter of getChangesetOperations fed from bindChangesetOperations.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/39-patent-ide-hide-pr-merge-checkout.patch"
