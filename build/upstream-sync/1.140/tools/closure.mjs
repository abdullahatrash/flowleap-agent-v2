/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Upstream files missing in the worktree that are transitively imported from the given roots.
// Usage: node closure.mjs <worktree> <upstream> [root...]   (default roots: the two synced trees)
// Never lists the agent host server layer (platform/agentHost/{node,electron-main,test}).
import fs from 'fs'; import path from 'path';
const [W, U, ...rootArgs] = process.argv.slice(2);
const roots = rootArgs.length ? rootArgs : ['src/vs/sessions', 'src/vs/platform/agentHost'];
const excluded = /^src\/vs\/platform\/agentHost\/(node|electron-main|test)\//;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);
const importRe = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const missing = new Set(); const skipped = new Set(); const queue = [];
for (const r of roots) { for (const f of walk(path.join(W, r))) { queue.push(f); } }
const seen = new Set();
while (queue.length) {
	const file = queue.pop();
	if (seen.has(file)) { continue; } seen.add(file);
	const src = fs.readFileSync(file, 'utf8');
	for (const m of src.matchAll(importRe)) {
		const spec = m[1] || m[2] || m[3];
		if (!spec || !spec.startsWith('.')) { continue; }
		const target = spec.endsWith('.css') ? path.resolve(path.dirname(file), spec) : path.resolve(path.dirname(file), spec).replace(/\.js$/, '.ts');
		const rel = path.relative(file.startsWith(U + '/') ? U : W, target);
		if (fs.existsSync(path.join(W, rel)) || !fs.existsSync(path.join(U, rel))) { continue; }
		if (excluded.test(rel)) { skipped.add(rel); continue; }
		if (!missing.has(rel)) { missing.add(rel); queue.push(path.join(U, rel)); }
	}
}
for (const m of [...missing].sort()) { console.log(m); }
for (const s of [...skipped].sort()) { console.error('SKIPPED(server layer): ' + s); }
