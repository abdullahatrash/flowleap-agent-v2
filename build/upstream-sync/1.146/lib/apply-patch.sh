#!/usr/bin/env bash
# Idempotently apply one re-apply patch to the worktree. Usage: apply-patch.sh <worktree> <patch>
set -euo pipefail
W="$1"; P="$2"
if git -C "$W" apply --check -R "$P" 2>/dev/null; then echo "already applied: $(basename "$P")"; exit 0; fi
git -C "$W" apply --whitespace=nowarn "$P"
echo "applied: $(basename "$P")"
