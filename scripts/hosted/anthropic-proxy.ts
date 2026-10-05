/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hosted Workspace key-injecting proxy (ADR 0011 decision 3, #507). Runs with the package's
// Node 24 (native type stripping). Listens on 127.0.0.1 only, accepts only loopback peers,
// removes the caller's credentials, adds the real x-api-key from this process's own
// environment and forwards to Anthropic. The server gets ANTHROPIC_BASE_URL=<this proxy>
// and a dummy ANTHROPIC_API_KEY, so the real key never enters the server process tree.
import * as http from 'node:http';
import * as https from 'node:https';

const port = Number(process.env.PROXY_PORT || 8787);
const key = process.env.ANTHROPIC_API_KEY;
const upstream = new URL(process.env.PROXY_UPSTREAM || 'https://api.anthropic.com');
if (!key) {
	console.error('anthropic-proxy: ANTHROPIC_API_KEY is not set');
	process.exit(1);
}
const request = upstream.protocol === 'https:' ? https.request : http.request;
const drop = new Set(['host', 'x-api-key', 'authorization', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade']);
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

http.createServer((req, res) => {
	if (!loopback.has(req.socket.remoteAddress ?? '')) {
		res.writeHead(403).end();
		return;
	}
	const headers: http.OutgoingHttpHeaders = {};
	for (const [name, value] of Object.entries(req.headers)) {
		if (!drop.has(name)) {
			headers[name] = value;
		}
	}
	headers['x-api-key'] = key;
	const out = request({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || undefined, method: req.method, path: req.url, headers }, up => {
		console.log(`${req.method} ${(req.url ?? '').split('?')[0]} -> ${up.statusCode}`);
		res.writeHead(up.statusCode || 502, up.headers);
		up.pipe(res);
	});
	out.on('error', err => {
		console.error(`anthropic-proxy: upstream error: ${err.message}`);
		if (!res.headersSent) {
			res.writeHead(502);
		}
		res.end();
	});
	req.pipe(out);
}).listen(port, '127.0.0.1', () => console.log(`anthropic-proxy: 127.0.0.1:${port} -> ${upstream.origin}`));
