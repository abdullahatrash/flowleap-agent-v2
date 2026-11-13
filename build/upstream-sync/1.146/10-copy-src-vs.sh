#!/usr/bin/env bash
# PRD 0027 PR B step 10: copy upstream src/vs + src/vscode-dts wholesale, restore the files the fork created,
# and re-point their imports at the paths upstream moved (the Agents Window code went to workbench/contrib/sessions).
# Unlike the 1.140 kit this keeps platform/agentHost/{node,electron-main}: the fork ships the agent host (PRD 0018).
# Usage: 10-copy-src-vs.sh <worktree>   (env: UPSTREAM, UPSTREAM_REF, FORK, FORK_REF, PREV_REF)
set -euo pipefail
W="${1:?worktree}"
U="${UPSTREAM:?set UPSTREAM to a vscode checkout that has UPSTREAM_REF (see README.md)}"
UREF="${UPSTREAM_REF:-1.146.0}"          # the upstream release this kit syncs to
PREV="${PREV_REF:-480c6e142fa}"           # the upstream release the fork was synced to before (1.140.0)
FORK="${FORK:-$W}"                        # any clone of the fork that has FORK_REF; the worktree itself works
REF="${FORK_REF:-1feddc94420}"            # the fork base (main after PRD 0027 PR A)
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${SYNC_OUT:-${TMPDIR:-/tmp}/upstream-sync-1.146}"; mkdir -p "$OUT"

# fork-only files = in the fork base, not in the upstream target
comm -23 <(git -C "$FORK" ls-tree -r --name-only "$REF" -- src/vs src/vscode-dts | sort) \
	<(git -C "$U" ls-tree -r --name-only "$UREF" -- src/vs src/vscode-dts | sort) > "$OUT/10-fork-only-all.txt"
# a path the previous upstream release had was deleted or moved upstream since: the copy subsumes it
git -C "$U" ls-tree -r --name-only "$PREV" -- src/vs src/vscode-dts | sort > "$OUT/10-prev-upstream-files.txt"
comm -12 "$OUT/10-fork-only-all.txt" "$OUT/10-prev-upstream-files.txt" > "$OUT/10-upstream-deleted.txt"
comm -23 "$OUT/10-fork-only-all.txt" "$OUT/10-prev-upstream-files.txt" | grep -vxF -f "$HERE/10-subsumed-fork-files.txt" > "$OUT/10-fork-only.txt" || true

rm -rf "$W/src/vs" "$W/src/vscode-dts"
git -C "$U" archive "$UREF" src/vs src/vscode-dts | tar -x -C "$W"

while IFS= read -r rel; do
	mkdir -p "$W/$(dirname "$rel")"
	git -C "$FORK" show "$REF:$rel" > "$W/$rel"
done < "$OUT/10-fork-only.txt"

# rename map of the paths upstream moved between PREV and UREF (tab-separated old<TAB>new), then rewrite the
# relative imports of the restored fork files that point at an old path
git -C "$U" -c diff.renameLimit=8000 diff -M --name-status "$PREV" "$UREF" -- src/vs src/vscode-dts \
	| awk -F'\t' '$1 ~ /^R/ {print $2"\t"$3}' > "$OUT/10-renames.tsv"
node "$HERE/tools/rewrite-imports.mjs" "$W" "$OUT/10-renames.tsv" "$OUT/10-fork-only.txt" | tail -1
echo "10 done: $(wc -l < "$OUT/10-fork-only.txt" | tr -d ' ') fork-only files restored, $(wc -l < "$OUT/10-upstream-deleted.txt" | tr -d ' ') upstream-deleted dropped"
