#!/usr/bin/env bash
# PRD 0017 v2 step 10: copy upstream src/vs + src/vscode-dts wholesale, restore fork-only files,
# drop the agent host server layer, retire platform/agentSessionState, rewrite its imports.
# Usage: 10-copy-src-vs.sh <worktree>   (env: UPSTREAM, FORK, FORK_REF)
set -euo pipefail
W="${1:?worktree}"
U="${UPSTREAM:?set UPSTREAM to a vscode checkout at the reference commit (see README.md)}"
FORK="${FORK:-$W}" # any clone of the fork that has FORK_REF; the worktree itself works
REF="${FORK_REF:-810ad70ca59}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# generated lists (fork-only, upstream-deleted) go outside the repo
OUT="${SYNC_OUT:-${TMPDIR:-/tmp}/upstream-sync-1.140}"; mkdir -p "$OUT"

# fork-only files = in fork REF, not in upstream HEAD; agentSessionState is the retired rename
comm -23 <(git -C "$FORK" ls-tree -r --name-only "$REF" -- src/vs src/vscode-dts | sort) \
	<(git -C "$U" ls-tree -r --name-only HEAD -- src/vs src/vscode-dts | sort) \
	| grep -v '^src/vs/platform/agentSessionState/' > "$OUT/10-fork-only-all.txt"
# keep only files the fork created: a path upstream ever had was deleted or moved upstream, so the
# copy subsumes it (re-apply scripts restore any such file whose intent the fork still needs)
: > "$OUT/10-fork-only.txt"; : > "$OUT/10-upstream-deleted.txt"
while IFS= read -r rel; do
	if [ -n "$(git -C "$U" log --oneline -1 HEAD -- "$rel")" ]; then echo "$rel" >> "$OUT/10-upstream-deleted.txt";
	elif grep -qxF "$rel" "$HERE/10-subsumed-fork-files.txt"; then :;
	else echo "$rel" >> "$OUT/10-fork-only.txt"; fi
done < "$OUT/10-fork-only-all.txt"

rm -rf "$W/src/vs" "$W/src/vscode-dts"
git -C "$U" archive HEAD src/vs src/vscode-dts | tar -x -C "$W"

while IFS= read -r rel; do
	mkdir -p "$W/$(dirname "$rel")"
	git -C "$FORK" show "$REF:$rel" > "$W/$rel"
done < "$OUT/10-fork-only.txt"

# agent host server layer is not shipped (PRD 0004)
rm -rf "$W/src/vs/platform/agentHost/node" "$W/src/vs/platform/agentHost/electron-main" "$W/src/vs/platform/agentHost/test/node"

grep -rl '/agentSessionState/' "$W/src" "$W/eslint.config.js" 2>/dev/null | while IFS= read -r f; do
	sed -i '' 's#/agentSessionState/#/agentHost/#g' "$f"
done
echo "10 done: $(wc -l < "$OUT/10-fork-only.txt" | tr -d ' ') fork-only files restored"
