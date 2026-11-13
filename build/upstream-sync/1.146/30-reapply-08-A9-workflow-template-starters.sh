#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-08-A9-workflow-template-starters. Applies patches/30-reapply-08-A9-workflow-template-starters.patch (written against upstream 1.146.0 after step 10-13).
# Re-derived (D6): fork-only sessionWorkflowTemplates.ts moved to workbench/contrib/sessions/common (LAYERS: workbench code may not import vs/sessions); chips render below the composer in newChatWidget.ts and prefill the input.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-08-A9-workflow-template-starters.patch"
