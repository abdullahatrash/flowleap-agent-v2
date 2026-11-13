/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// PRD 0027 PR B, intent B5a + D7: rebrand the user-reachable Copilot strings by nls key.
// Usage: node rebrand-strings.ts <worktree> [--dry] [--skip <path-prefix>]...
// Table: rebrand-strings.json (key, old, new, file as of 1.140). A key whose current literal equals `old`
// is rewritten to `new`; a key whose literal differs is listed as REWORDED (hand decision); a missing key as GONE.
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const root = args.shift();
const dry = args.includes('--dry');
const skips = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--skip') { skips.push(args[++i]); } }
const table = JSON.parse(fs.readFileSync(new URL('./rebrand-strings.json', import.meta.url), 'utf8'));
const byKey = new Map();
for (const row of table) { (byKey.get(row.key) ?? byKey.set(row.key, []).get(row.key)).push(row); }
const files = [];
(function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) { walk(p); } else if (entry.name.endsWith('.ts')) { files.push(p); }
	}
})(path.join(root, 'src/vs'));
const re = /(localize2?\(\s*(?:\{\s*key:\s*)?'([^']+)'[^,]*?,\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
const applied = [], reworded = [], seen = new Set(), skipped = [];
for (const file of files) {
	const rel = path.relative(root, file);
	let text = fs.readFileSync(file, 'utf8');
	let changed = false;
	text = text.replace(re, (m, head, key, literal) => {
		const rows = byKey.get(key);
		if (!rows) { return m; }
		seen.add(key);
		if (skips.some(s => rel.startsWith(s))) { skipped.push(`${rel} ${key}`); return m; }
		const row = rows.find(r => r.old === literal) ?? rows[0];
		if (literal === row.new) { return m; }
		if (literal !== row.old) { reworded.push(`${rel} ${key}: ${literal} (1.140 patch: ${row.old} -> ${row.new})`); return m; }
		applied.push(`${rel} ${key}`); changed = true;
		return head + row.new;
	});
	if (changed && !dry) { fs.writeFileSync(file, text); }
}
const gone = [...byKey.keys()].filter(k => !seen.has(k));
console.log(`applied ${applied.length}${dry ? ' (dry run)' : ''}`); applied.forEach(l => console.log('  ' + l));
console.log(`reworded ${reworded.length}`); reworded.forEach(l => console.log('  ' + l));
console.log(`skipped ${skipped.length}`); skipped.forEach(l => console.log('  ' + l));
console.log(`gone ${gone.length}`); gone.forEach(l => console.log('  ' + l));
