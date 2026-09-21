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
// This has to run BEFORE the copilot extension is copied into `.build`, because
// that copy is what ends up in the product. Materializing afterwards would
// leave the artifact untouched.

const CONTEXT = 'prepareSharpPlatformPackages';

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
 * The `@img` packages the target needs.
 *
 * On darwin and linux the library lives in a second package that the platform
 * package declares as its own optional dependency, so a cross-build needs both
 * or sharp cannot load at all. win32 bundles the library inside the platform
 * package and has no second one.
 */
export function sharpPackagesFor(sharpPlatformArch: string): string[] {
	const packages = [`@img/sharp-${sharpPlatformArch}`];
	if (!sharpPlatformArch.startsWith('win32-')) {
		packages.push(`@img/sharp-libvips-${sharpPlatformArch}`);
	}
	return packages;
}

/**
 * Prepares the copilot extension's `node_modules` so packaging picks up the
 * TARGET's sharp rather than the host's.
 *
 * Materializes what the target needs and removes every other `@img/sharp*`
 * package, so the artifact carries exactly one architecture. Removing from the
 * working tree is safe and self-healing: a later build for another target
 * materializes what it needs from the lockfile, much as
 * `build/npm/postinstall.ts` already deletes the `@parcel/watcher` prebuilds.
 *
 * A no-op when the agent SDK that pulls sharp in is not installed, so this
 * cannot fail a build that never needed sharp.
 */
export function prepareSharpPlatformPackages(platform: string, arch: string, nodeModulesRoot = path.join('extensions', 'copilot', 'node_modules'), options: IEnsurePlatformPackageOptions = {}): void {
	const sharpPlatformArch = toSharpPlatformArch(platform, arch);
	if (!sharpPlatformArch) {
		return;
	}

	// Only the SDK declares these packages; without it there is nothing to ship.
	if (!fs.existsSync(path.join(nodeModulesRoot, '@anthropic-ai', 'claude-agent-sdk'))) {
		return;
	}

	const wanted = sharpPackagesFor(sharpPlatformArch);
	for (const packageName of wanted) {
		ensurePlatformPackage(packageName, nodeModulesRoot, CONTEXT, options);
	}

	removeForeignSharpPackages(nodeModulesRoot, wanted);
}

/**
 * Deletes every `@img/sharp*` package that is not in `keep`.
 *
 * Without this the host's package ships alongside the target's: harmless at
 * runtime, since sharp loads the one named for the running platform and arch,
 * but it puts a megabyte of another architecture's binary in the artifact.
 */
function removeForeignSharpPackages(nodeModulesRoot: string, keep: string[]): void {
	const imgDir = path.join(nodeModulesRoot, '@img');
	if (!fs.existsSync(imgDir)) {
		return;
	}

	const keepNames = new Set(keep.map(name => name.slice('@img/'.length)));
	for (const entry of fs.readdirSync(imgDir)) {
		if (!entry.startsWith('sharp') || keepNames.has(entry)) {
			continue;
		}
		fs.rmSync(path.join(imgDir, entry), { recursive: true, force: true });
		console.log(`[${CONTEXT}] Removed non-target @img/${entry}`);
	}
}
