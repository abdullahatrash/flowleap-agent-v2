/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
const [dir, f, u, p] = process.argv.slice(2);
const load = x => new Map(fs.readFileSync(x, 'utf8').trim().split('\n').map(l => l.split('\t')));
const F = load(f), U = load(u), P = load(p);
const groups = {};
const key = path => path.split('/').slice(0, 4).join('/');
const inc = (k, c) => { groups[k] ??= { identical: 0, stale: 0, touched: 0, forkonly: 0, upstreamonly: 0 }; groups[k][c]++; };
for (const [path, h] of F) { if (!path.startsWith(dir)) continue; const k = key(path); if (!U.has(path)) inc(k, 'forkonly'); else if (U.get(path) === h) inc(k, 'identical'); else if (P.get(path) === h) inc(k, 'stale'); else inc(k, 'touched'); }
for (const [path] of U) { if (!path.startsWith(dir)) continue; if (!F.has(path)) inc(key(path), 'upstreamonly'); }
const tot = { identical: 0, stale: 0, touched: 0, forkonly: 0, upstreamonly: 0 };
for (const [k, v] of Object.entries(groups).sort()) { for (const c in v) tot[c] += v[c]; console.log(k.padEnd(40), JSON.stringify(v)); }
console.log('TOTAL'.padEnd(40), JSON.stringify(tot));
