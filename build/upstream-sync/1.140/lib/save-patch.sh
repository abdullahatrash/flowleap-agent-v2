#!/usr/bin/env bash
# Save the worktree's uncommitted changes under the given paths as a patch and write its runner script.
# Usage: save-patch.sh <worktree> <script-name-without-.sh> <path>...
set -euo pipefail
W="$1"; NAME="$2"; shift 2; HERE="$(cd "$(dirname "$0")/.." && pwd)"
git -C "$W" add -N -- "$@" 2>/dev/null || true
git -C "$W" diff --binary -- "$@" > "$HERE/patches/$NAME.patch"
[ -s "$HERE/patches/$NAME.patch" ] || { echo "empty patch for $NAME" >&2; exit 1; }
cat > "$HERE/$NAME.sh" <<EOS
#!/usr/bin/env bash
# PRD 0017 v2: $NAME. Applies patches/$NAME.patch (written against upstream 480c6e142fa after step 10).
set -euo pipefail
HERE="\$(cd "\$(dirname "\$0")" && pwd)"
"\$HERE/lib/apply-patch.sh" "\${1:?worktree}" "\$HERE/patches/$NAME.patch"
EOS
chmod +x "$HERE/$NAME.sh"
echo "saved $NAME ($(grep -c '^diff --git' "$HERE/patches/$NAME.patch") files)"
