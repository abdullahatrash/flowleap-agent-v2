#!/usr/bin/env bash
# PRD 0027 PR B: B15 — open product-scheme links from webviews on web (#549). Applies patches/31-reapply-51-B15-webview-product-links.patch (written against upstream 1.146.0 after step 10-13).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/31-reapply-51-B15-webview-product-links.patch"
