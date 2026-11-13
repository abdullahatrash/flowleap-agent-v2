#!/usr/bin/env bash
# PRD 0027 PR B: 30-reapply-18-A23-drop-copilot-cli-and-mxc-deps. Removes @github/copilot (the Copilot CLI) and @microsoft/mxc-sdk from package.json and remote/package.json: nothing under src/ or remote/ imports them (the agent host's Copilot files import @github/copilot-sdk, which stays) and upstream 1.146.0 does not list them. The lockfiles are not patched: the script refreshes them with pnpm install --no-frozen-lockfile.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/30-reapply-18-A23-drop-copilot-cli-and-mxc-deps.patch"
(cd "$1" && pnpm install --no-frozen-lockfile)
