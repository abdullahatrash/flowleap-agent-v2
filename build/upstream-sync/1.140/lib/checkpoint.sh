#!/usr/bin/env bash
# Save all uncommitted tracked+new changes under src/ (and given extra paths) as <name>.patch, write the runner,
# and commit them on the spike branch. Usage: checkpoint.sh <worktree> <name> [extra paths...]
set -euo pipefail
W="$1"; NAME="$2"; shift 2; HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$W"
P=()
while IFS= read -r line; do P+=("$line"); done < <( { git diff --name-only -- src "$@"; git ls-files --others --exclude-standard -- src "$@"; } | sort -u )
[ "${#P[@]}" -gt 0 ] || { echo "nothing to checkpoint" >&2; exit 1; }
"$HERE/save-patch.sh" "$W" "$NAME" "${P[@]}"
git add -- "${P[@]}"
git commit -q --no-verify -m "spike 0017 v2: $NAME" -- "${P[@]}"
git log --oneline -1
