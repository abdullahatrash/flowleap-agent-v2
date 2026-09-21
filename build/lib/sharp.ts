/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { ensurePlatformPackage } from './platformPackage.ts';
import type { IEnsurePlatformPackageOptions } from './platformPackage.ts';

// `@anthropic-ai/claude-agent-sdk` gets its image support from the
// `@img/sharp-{platform}-{arch}` family, declared as optional dependencies. npm
// installs only the one matching the HOST, so a cross-built leg shipped the
// host's binary: the Windows arm64 artifact carried an x64 `sharp.node` (#461).
//
// sharp resolves its binary at runtime by `process.platform`/`process.arch`, so
// the fix is simply to make sure the TARGET's package is on disk before
// packaging reads the extension tree.

const CONTEXT = 'ensureSharpPlatformPackage';

/**
 * The targets `@img` publishes a sharp package for.
 *
 * `linuxmusl-*` covers alpine. There is no `linux-armhf`: sharp's 32-bit ARM
 * package is `@img/sharp-linux-arm`, matching Node's `process.arch === 'arm'`.
 */
export const sharpPlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm', 'linux-arm64', 'linux-x64',
	'linuxmusl-arm64', 'linuxmusl-x64',
	'win32-arm64', 'win32-x64',
];

/**
 * Converts a VS Code build platform/arch pair to the sharp package suffix,
 * or `undefined` when sharp publishes nothing for that target.
 */
export function toSharpPlatformArch(platform: string, arch: string): string | undefined {
	let candidate: string;
	if (platform === 'alpine') {
		candidate = `linuxmusl-${arch}`;
	} else if (arch === 'alpine') {
		candidate = 'linuxmusl-x64';
	} else if (arch === 'armhf') {
		candidate = `${platform}-arm`;
	} else {
		candidate = `${platform}-${arch}`;
	}

	return sharpPlatforms.includes(candidate) ? candidate : undefined;
}

/**
 * Ensures the target's `@img/sharp-*` package is present in the copilot
 * extension's `node_modules` before it is packaged.
 *
 * A no-op on a native build, where npm already installed the right one, and a
 * no-op when the agent SDK that pulls sharp in is not installed at all, so this
 * cannot fail a build that never needed sharp.
 *
 * Note: the host's package is NOT removed. It stays in the artifact as dead
 * weight of about a megabyte, which is harmless because sharp loads the package
 * named for the runtime's own platform and arch. Stripping it as well would
 * mean threading a filter through the built-in extension stream, which is a
 * larger change than the defect warrants.
 */
export function ensureSharpPlatformPackage(platform: string, arch: string, nodeModulesRoot = path.join('extensions', 'copilot', 'node_modules'), options: IEnsurePlatformPackageOptions = {}): void {
	const sharpPlatformArch = toSharpPlatformArch(platform, arch);
	if (!sharpPlatformArch) {
		return;
	}

	// Only the SDK declares these packages; without it there is nothing to ship.
	if (!fs.existsSync(path.join(nodeModulesRoot, '@anthropic-ai', 'claude-agent-sdk'))) {
		return;
	}

	ensurePlatformPackage(`@img/sharp-${sharpPlatformArch}`, nodeModulesRoot, CONTEXT, options);
}
