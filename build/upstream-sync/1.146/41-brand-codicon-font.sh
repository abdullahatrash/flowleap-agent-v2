#!/usr/bin/env bash
# PRD 0017 v2 step 41 (forced, outside src/; B5 brand intent from 708ec334676 #5): the FlowLeap codicon font
# build/flowleap/codicon.ttf must be regenerated from the codicons version step 11 installs, or glyphs upstream
# added render as empty boxes. Also teaches the patch script upstream's two new copilot glyphs.
# Needs fontforge (brew install fontforge).
set -euo pipefail
W="${1:?worktree}"
cd "$W"
P=build/flowleap/patch-copilot-glyphs.py
if ! grep -q "copilot-dot'" "$P"; then
	python3 - "$P" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
anchor = "\t(0xec42, SLASH, 'copilot-unavailable'),\n"
assert anchor in s
s = s.replace(anchor, anchor + "\t(0xecf2, TR, 'copilot-dot'),\n\t(0xecf3, TR, 'copilot-dot-compact'),\n", 1)
open(p, 'w').write(s)
PY
fi
fontforge -quiet -script "$P" node_modules/@vscode/codicons/dist/codicon.ttf build/flowleap/codicon.ttf >/dev/null 2>&1
# dev builds read the font from src/ (gitignored copy) and out/
cp build/flowleap/codicon.ttf src/vs/base/browser/ui/codicons/codicon/codicon.ttf
if [ -d out/vs/base/browser/ui/codicons/codicon ]; then cp build/flowleap/codicon.ttf out/vs/base/browser/ui/codicons/codicon/codicon.ttf; fi
echo "41 done"
