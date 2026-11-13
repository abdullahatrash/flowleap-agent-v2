#!/usr/bin/env bash
# PRD 0027 PR B: D7 — media-preview moved into core (upstream e7d9908a81d, vs/workbench/contrib/mediaPreview).
# Deletes extensions/media-preview, drops it from the extension build lists and the workspace, restores the
# imageEncoderWorkerMain worker entry PR A had commented out, then refreshes extensions/pnpm-lock.yaml.
set -euo pipefail
W="${1:?worktree}"
cd "$W"
[ -d extensions/media-preview ] && git rm -rq extensions/media-preview
node - <<'JS'
const fs = require('node:fs');
const edits = [
	['build/npm/dirs.ts', "\t\t'extensions/media-preview',\n", ''],
	['build/gulpfile.extensions.ts', "\t'extensions/media-preview/tsconfig.json',\n", ''],
	['extensions/pnpm-workspace.yaml', '  - media-preview\n', ''],
	['build/lib/changedFiles.ts', /\t'extensions\/media-preview\/',[^\n]*\n/, ''],
	['build/next/index.ts', /\t\/\/ 'vs\/workbench\/contrib\/mediaPreview\/browser\/imageEncoderWorkerMain'[^\n]*\n/, "\t'vs/workbench/contrib/mediaPreview/browser/imageEncoderWorkerMain',\n"],
];
for (const [file, from, to] of edits) {
	const text = fs.readFileSync(file, 'utf8');
	const next = text.replace(from, to);
	if (next !== text) { fs.writeFileSync(file, next); console.log('edited', file); } else { console.log('already done', file); }
}
JS
grep -q "imageEncoderWorkerMain" build/next/index.ts || { echo "worker entry missing in build/next/index.ts" >&2; exit 1; }
pnpm install   # non-frozen: updates extensions/pnpm-lock.yaml
