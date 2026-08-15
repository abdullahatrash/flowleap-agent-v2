/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stamps the native-updater fields into the ROOT product.json so the release
// build becomes a Stamped Build (ADR 0008): `updateUrl` is the website origin
// (the update service appends /api/update/{platform}/{quality}/{commit} itself,
// see createUpdateURL in src/vs/platform/update/electron-main/abstractUpdateService.ts)
// and `quality` is the single release channel.
//
// `commit` and `date` are deliberately NOT stamped here: the gulp package task
// injects them itself (build/gulpfile.vscode.ts, `json.commit = commit` from
// build/lib/getVersion.ts — the real source sha, never a version string).
//
// Run at release time, BEFORE the `vscode-<platform>-<arch>` package task, so
// the fields land in the built app's product.json. The checked-in product.json
// must never gain these fields — without them the update service disables
// itself (MissingConfiguration), which keeps dev/local builds inert. This edit
// is ephemeral CI state; it is not committed.

import { readFileSync, writeFileSync } from 'node:fs';

const updateUrl = 'https://www.flowleap.co';
const quality = 'stable';

const productPath = new URL('../../product.json', import.meta.url);
const product = JSON.parse(readFileSync(productPath, 'utf8'));
product.updateUrl = updateUrl;
product.quality = quality;
writeFileSync(productPath, `${JSON.stringify(product, null, '\t')}\n`);

console.log(`stamp-update-config: set product.json updateUrl=${updateUrl}, quality=${quality}`);
