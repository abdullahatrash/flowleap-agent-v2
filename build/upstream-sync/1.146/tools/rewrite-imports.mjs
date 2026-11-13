/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Rewrites the relative import specifiers of the given files when their target moved (rename map).
// Usage: node rewrite-imports.mjs <worktree> <renames.tsv old<TAB>new> <files.txt>
import fs from 'fs';
import path from 'path';
const [root, renamesFile, filesFile] = process.argv.slice(2);
const renames = new Map(fs.readFileSync(renamesFile, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split('\t')));
const files = fs.readFileSync(filesFile, 'utf8').trim().split('\n').filter(f => /\.(ts|mts|cts|js|mjs|css)$/.test(f));
let rewritten = 0, filesChanged = 0;
const specifier = /((?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;
for (const rel of files) {
	const abs = path.join(root, rel);
	if (!fs.existsSync(abs)) { continue; }
	const src = fs.readFileSync(abs, 'utf8');
	const dir = path.posix.dirname(rel);
	const out = src.replace(specifier, (m, pre, q, spec) => {
		const target = path.posix.normalize(path.posix.join(dir, spec));
		const candidates = [target, target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.mts')];
		for (const c of candidates) {
			const moved = renames.get(c);
			if (moved) {
				let next = path.posix.relative(dir, moved.replace(/\.ts$/, '.js'));
				if (!next.startsWith('.')) { next = './' + next; }
				rewritten++;
				return `${pre}${q}${next}${q}`;
			}
		}
		return m;
	});
	if (out !== src) { fs.writeFileSync(abs, out); filesChanged++; }
}
console.log(`rewrite-imports: ${rewritten} specifiers in ${filesChanged} files`);
