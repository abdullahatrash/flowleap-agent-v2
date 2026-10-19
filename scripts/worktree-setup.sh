#!/usr/bin/env bash
# Make a fresh git worktree of flowleap-agent-v2 runnable without a second npm install.
#
# Usage:
#   scripts/worktree-setup.sh <worktree-path> [--no-build]
#
# What it does, idempotently, from the main checkout that owns the worktree:
#   1. links node_modules at the root, build/, extensions/, every extension and nested extension
#      (the third one, build/node_modules, is the one everybody forgets: esbuild lives there)
#   2. links .build/ (the built Electron, ~300 MB) and seeds out/ by copy when the worktree has none
#   3. links .claude/skills -> .agents/skills and copies in untracked skill folders the main checkout
#      carries (for example verify-flowleap-ide), minus their artifacts
#   4. unless --no-build: transpiles core into out/, builds the copilot extension, the built-in
#      extensions and the extension media, and checks the three files the launch harness needs
#
# Known limits of a linked worktree: ~26 spec files that load tree-sitter/WASM grammars through the
# symlink fail (platform/parser, notebook/alternativeContent, summarizeDocument, xtab, inlineEdits,
# createWebSocket, getInlineCompletions, fileVariable); they pass in a real checkout. The husky
# pre-commit hook cannot run here either; commit with --no-verify and hand-check the hygiene rules.
set -euo pipefail

usage() {
	echo "usage: $0 <worktree-path> [--no-build]" >&2
	exit 2
}

[ $# -ge 1 ] || usage
WT="$(cd "$1" && pwd)"
BUILD=1
[ "${2:-}" = "--no-build" ] && BUILD=0

# The first entry of `git worktree list` is the main working tree that owns the others.
MAIN="$(git -C "$WT" worktree list --porcelain | head -1 | sed 's/^worktree //')"
[ -d "$MAIN/node_modules" ] || { echo "main checkout $MAIN has no node_modules; run npm ci there first" >&2; exit 1; }
[ "$MAIN" != "$WT" ] || { echo "$WT is the main checkout, nothing to link" >&2; exit 1; }

link() {
	local src="$1" dst="$2"
	[ -e "$src" ] || return 0
	if [ -e "$dst" ] || [ -L "$dst" ]; then
		return 0
	fi
	mkdir -p "$(dirname "$dst")"
	ln -s "$src" "$dst"
	echo "linked ${dst#$WT/}"
}

echo "== node_modules links from $MAIN"
link "$MAIN/node_modules" "$WT/node_modules"
link "$MAIN/build/node_modules" "$WT/build/node_modules"
link "$MAIN/extensions/node_modules" "$WT/extensions/node_modules"
for d in "$MAIN"/extensions/*/node_modules "$MAIN"/extensions/*/*/node_modules "$MAIN"/.vscode/extensions/*/node_modules; do
	[ -e "$d" ] || continue
	link "$d" "$WT/${d#$MAIN/}"
done

echo "== build artifacts"
link "$MAIN/.build" "$WT/.build"
if [ ! -e "$WT/out" ] && [ -d "$MAIN/out" ]; then
	echo "copying out/ (only valid until core is transpiled below)"
	cp -a "$MAIN/out" "$WT/out"
fi

echo "== skills"
mkdir -p "$WT/.claude"
[ -e "$WT/.claude/skills" ] || { ln -s ../.agents/skills "$WT/.claude/skills"; echo "linked .claude/skills -> .agents/skills"; }
for d in "$MAIN"/.agents/skills/*/; do
	name="$(basename "$d")"
	[ -e "$WT/.agents/skills/$name" ] && continue
	mkdir -p "$WT/.agents/skills"
	cp -R "$d" "$WT/.agents/skills/$name"
	rm -rf "$WT/.agents/skills/$name/artifacts"/*
	echo "copied untracked skill $name"
done

if [ "$BUILD" = "1" ]; then
	cd "$WT"
	echo "== transpile core"
	node build/next/index.ts transpile
	echo "== build copilot extension"
	(cd extensions/copilot && npm run compile)
	echo "== compile built-in extensions (typescript-language-features reports implicit-any noise and still emits)"
	npm run gulp compile-extensions || true
	echo "== compile extension media"
	npm run gulp compile-extension-media
	echo "== launch prerequisites"
	for f in out/main.js extensions/copilot/dist/extension.js extensions/flowleap/out/extension.js; do
		[ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
		echo "ok $f"
	done
fi

echo "worktree ready: $WT"
echo "launch it with: cd $WT && .claude/skills/verify-flowleap-ide/scripts/control-flowleap-ide up"
