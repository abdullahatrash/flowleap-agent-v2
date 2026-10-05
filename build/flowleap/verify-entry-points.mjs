/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Fails when a module that the product spawns as a separate process or worker
// is not built. A spawned module is loaded by path at run time, so no bundler
// follows an import to it: it ships only when build/next/index.ts lists it as
// an entry point. v0.5.0 shipped without the agent host (#511) because its two
// entries were removed from that list and nothing noticed.
//
// The spawned modules are discovered from the sources, not from a hand list:
//   VSCODE_ESM_ENTRYPOINT: 'vs/...'   (utility and forked processes)
//   entryPoint: 'vs/...'              (Electron utility processes)
//   asFileUri('vs/...Main.js')        (worker threads)
//
// Usage:
//   node build/flowleap/verify-entry-points.mjs
//       Source check (no build needed): every spawned module is listed in
//       build/next/index.ts.
//   node build/flowleap/verify-entry-points.mjs --app-out=<app>/out
//       Artifact check: every spawned module exists as a .js file in the
//       packaged product's out folder.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const patterns = [
	/VSCODE_ESM_ENTRYPOINT['"]?\s*:\s*['"](?<module>vs\/[^'"]+)['"]/g,
	/\bentryPoint\s*:\s*['"](?<module>vs\/[^'"]+)['"]/g,
	/asFileUri\(\s*['"](?<module>vs\/[^'"]+Main)\.js['"]/g,
];

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'test') {
				files.push(...sourceFiles(path));
			}
		} else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
			files.push(path);
		}
	}
	return files;
}

/** @type {Map<string, string>} module id -> first source file that spawns it */
const spawned = new Map();
for (const file of sourceFiles(join(root, 'src', 'vs'))) {
	const text = readFileSync(file, 'utf8');
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			const module = match.groups?.module;
			if (module && !spawned.has(module)) {
				spawned.set(module, relative(root, file));
			}
		}
	}
}

if (spawned.size === 0) {
	console.error('::error::No spawned modules found under src/vs. The discovery patterns in this script are out of date.');
	process.exit(1);
}

const appOutArg = process.argv.find(arg => arg.startsWith('--app-out='));
const missing = [];
if (appOutArg) {
	const appOut = appOutArg.slice('--app-out='.length);
	if (!existsSync(appOut)) {
		console.error(`::error::The packaged out folder does not exist: ${appOut}`);
		process.exit(1);
	}
	for (const [module, source] of spawned) {
		const file = join(appOut, `${module}.js`);
		console.log(`${existsSync(file) ? 'ok     ' : 'MISSING'} ${module}.js (spawned by ${source})`);
		if (!existsSync(file)) {
			missing.push(module);
		}
	}
} else {
	const entryList = readFileSync(join(root, 'build', 'next', 'index.ts'), 'utf8');
	for (const [module, source] of spawned) {
		const listed = entryList.includes(`'${module}'`);
		console.log(`${listed ? 'ok     ' : 'MISSING'} ${module} (spawned by ${source})`);
		if (!listed) {
			missing.push(module);
		}
	}
}

if (missing.length > 0) {
	const where = appOutArg ? 'the packaged product' : 'the entry-point lists in build/next/index.ts';
	console.error(`::error::${missing.length} spawned module(s) missing from ${where}: ${missing.join(', ')}. Add each to build/next/index.ts (and build/buildfile.ts).`);
	process.exit(1);
}
console.log(`All ${spawned.size} spawned modules are present.`);
