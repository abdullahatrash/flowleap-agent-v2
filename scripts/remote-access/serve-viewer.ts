/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Serves a built Viewer site locally, the way nginx serves it on remote.flowleap.co
// (install-viewer.sh): files as they are, and index.html for every other path
// (`/`, `/pair`, `/<version>/`). For local development and the end-to-end check only.
//
//   node scripts/remote-access/serve-viewer.ts [--out out-viewer] [--port 3000] [--host 127.0.0.1]
//
// Port 3000 is on the backend's CORS allowlist for local development.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

function arg(name: string, fallback: string): string {
	const index = process.argv.indexOf(name);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const root = path.resolve(arg('--out', 'out-viewer'));
const port = Number(arg('--port', '3000'));
const host = arg('--host', '127.0.0.1');

const types: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ttf': 'font/ttf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.wasm': 'application/wasm',
	'.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
	const url = new URL(req.url ?? '/', `http://${host}:${port}`);
	const file = path.join(root, decodeURIComponent(url.pathname));
	if (!file.startsWith(root)) {
		res.writeHead(403).end();
		return;
	}
	let target = file;
	if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
		// A build folder (`/0.9.0/`) or a page path gets the boot page; a missing file is a 404.
		if (!url.pathname.endsWith('/') && !(fs.existsSync(target) && fs.statSync(target).isDirectory()) && path.extname(url.pathname)) {
			res.writeHead(404).end('Not found');
			return;
		}
		target = path.join(root, 'index.html');
	}
	res.writeHead(200, {
		'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
		'Cache-Control': target.endsWith('.html') || target.endsWith('.json') || target.endsWith('loader.js') ? 'no-store' : 'public, max-age=3600',
	});
	fs.createReadStream(target).pipe(res);
});

server.listen(port, host, () => console.log(`Viewer site ${root} at http://${host}:${port}/`));
