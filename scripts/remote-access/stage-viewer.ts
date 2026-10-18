/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stages a Remote Access Viewer build (called by build-viewer.sh, PRD 0018 B4):
//
//   node scripts/remote-access/stage-viewer.ts <repo root> <out dir> <version>
//
// Runs with Node 24 (native type stripping).
//
// - copies remote/web/node_modules into <out>/<version>/node_modules, without the
//   files build/.webignore drops (the web client loads these modules at run time)
// - writes the site root: index.html, loader.js (from the bundle), config.example.json
// - writes <out>/versions.json from the builds found under <out>, newest first

import * as fs from 'node:fs';
import * as path from 'node:path';
import ignore from 'ignore';

const [root, outDir, version] = process.argv.slice(2);
if (!root || !outDir || !version) {
	console.error('usage: stage-viewer.ts <repo root> <out dir> <version>');
	process.exit(1);
}

const buildDir = path.join(outDir, version);
const bundleOut = path.join(buildDir, 'out');
const site = path.join(root, 'scripts', 'remote-access', 'viewer-site');

// ---- node_modules ----
const webignore = ignore().add(fs.readFileSync(path.join(root, 'build', '.webignore'), 'utf8'));
const modulesSource = path.join(root, 'remote', 'web', 'node_modules');
const modulesTarget = path.join(buildDir, 'node_modules');
let copied = 0;
function copyTree(relative: string): void {
	const source = path.join(modulesSource, relative);
	for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
		const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
		const stat = fs.statSync(path.join(source, entry.name));
		if (stat.isDirectory()) {
			if (!webignore.ignores(`${childRelative}/`)) {
				copyTree(childRelative);
			}
		} else if (!webignore.ignores(childRelative)) {
			const target = path.join(modulesTarget, childRelative);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(path.join(source, entry.name), target);
			copied++;
		}
	}
}
copyTree('');
console.log(`[stage-viewer] node_modules: ${copied} files`);

// ---- site root ----
const loaderSource = path.join(bundleOut, 'vs', 'sessions', 'contrib', 'remoteAccess', 'browser', 'viewer', 'remoteAccessViewerLoader.js');
if (!fs.existsSync(loaderSource)) {
	console.error(`[stage-viewer] the bundle has no ${loaderSource}`);
	process.exit(1);
}
const loader = fs.readFileSync(loaderSource, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n');
fs.writeFileSync(path.join(outDir, 'loader.js'), loader);
fs.copyFileSync(path.join(site, 'index.html'), path.join(outDir, 'index.html'));
fs.copyFileSync(path.join(site, 'config.example.json'), path.join(outDir, 'config.example.json'));

// ---- versions.json ----
const marker = path.join('out', 'vs', 'sessions', 'sessions.viewer.main.js');
const builds = fs.readdirSync(outDir, { withFileTypes: true })
	.filter(entry => entry.isDirectory() && fs.existsSync(path.join(outDir, entry.name, marker)))
	.map(entry => ({ name: entry.name, time: fs.statSync(path.join(outDir, entry.name, marker)).mtimeMs }))
	.sort((a, b) => b.time - a.time)
	.map(entry => entry.name);
fs.writeFileSync(path.join(outDir, 'versions.json'), `${JSON.stringify({ latest: version, versions: [version, ...builds.filter(name => name !== version)] }, null, '\t')}\n`);
console.log(`[stage-viewer] versions.json: latest ${version}, ${builds.length} build(s)`);
