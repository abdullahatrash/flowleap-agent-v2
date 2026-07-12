/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stamps the FlowLeap release version into extensions/flowleap/package.json so the
// running app knows its own identity. The bundled `flowleap` extension's update
// notifier reads `context.extension.packageJSON.version` and compares it against
// the website's /api/latest-version. Without this, the extension ships the
// placeholder version and the notifier would either nag forever or never fire.
//
// Run at release time, BEFORE the `vscode-<platform>-<arch>` package task bundles
// the extension. The version is taken from FLOWLEAP_VERSION (or argv[2]) —
// typically the git tag — and a leading `v` is stripped. This edit is ephemeral
// CI state; it is not committed.

import { readFileSync, writeFileSync } from 'node:fs';

const raw = process.env.FLOWLEAP_VERSION ?? process.argv[2] ?? '';
const version = raw.replace(/^v/, '').trim();

if (!/^\d+\.\d+\.\d+/.test(version)) {
	console.error(`stamp-flowleap-version: refusing to stamp invalid version "${raw}"`);
	process.exit(1);
}

const packagePath = new URL('../../extensions/flowleap/package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
pkg.version = version;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`stamp-flowleap-version: set extensions/flowleap/package.json version to ${version}`);
