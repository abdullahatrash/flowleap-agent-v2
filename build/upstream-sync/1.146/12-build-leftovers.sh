#!/usr/bin/env bash
# PRD 0027 PR B: build leftovers — i18n resource list (drop the removed vs/workbench/contrib/welcomeAgentSessions
# entry, keep the fork entries patent/flowleapCli/remoteAccess) and the product.json webview host pin
# (webviewContentExternalBaseUrlTemplate = the upstream release commit; verified with curl --compressed).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="${1:?worktree}"
"$HERE/lib/apply-patch.sh" "$W" "$HERE/patches/12-build-leftovers.patch"
sed -i '' -E 's#(vscode-cdn\.net/stable/)[0-9a-f]{40}#\169047191fc427f2f92828279aae1d90d8eeda7ab#' "$W/product.json"
