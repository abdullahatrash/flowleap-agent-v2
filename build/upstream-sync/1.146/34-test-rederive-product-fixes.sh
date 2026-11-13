#!/usr/bin/env bash
# PRD 0027 PR B: product hunks the unit-test re-derivation found missing after the four groups merged:
# B17 avatar fallback in globalCompositeBar.ts, B6b public-feed constant (the FlowLeap default marketplace
# was hidden from Discover while the GitHub public feed was on), B5a chatSetupRunner wording.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/lib/apply-patch.sh" "${1:?worktree}" "$HERE/patches/34-test-rederive-product-fixes.patch"
