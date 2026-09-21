/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { dirs } from './dirs.ts';

// Some dependencies ship their native binary in a per-platform package that is
// declared as an *optional* dependency — `@github/copilot` is a thin launcher
// whose binary lives in `@github/copilot-<platform>-<arch>`, and
// `@anthropic-ai/claude-agent-sdk` gets its image support from the
// `@img/sharp-<platform>-<arch>` family.
//
// Two different things go wrong with that arrangement, and this file exists for
// both.
//
// 1. npm does NOT fail when an optional dependency cannot be installed, so a
//    transient hiccup leaves the base package present and its native package
//    missing (upstream's original motivation, microsoft/vscode#323881).
//
// 2. On a CROSS-BUILT leg the wrong architecture is selected. npm picks
//    optional dependencies by matching each candidate's `cpu`/`os` fields
//    against the npm config keys `cpu` and `os`, which default to the HOST's
//    `process.arch`/`process.platform`. `npm_config_arch` does not enter into
//    it — that steers node-gyp and prebuild-install only. So the Windows arm64
//    build on an x64 runner silently installed `@img/sharp-win32-x64` and
//    shipped an x64 `.node` inside the arm64 artifact (#461).
//
// Forcing `npm_config_cpu`/`npm_config_os` at install time would fix (2) and
// break the build, because the same keys also move the HOST tools in the tree —
// `@typescript/native-preview` (tsgo) above all, which packaging spawns. An
// arm64 tsgo cannot run on an x64 runner. So (2) is fixed where the distinction
// between a shipped package and a host tool actually exists: packaging
// materializes the target's package for the few dependencies that ship
// (build/lib/platformPackage.ts).
//
// What is left for this checker is (1), which is a HOST-tree question: run it
// after `npm ci` with no arguments and it verifies the install it just did. The
// target arguments exist for diagnosing a cross-build by hand.
//
// Nothing here is hardcoded to a particular package. The rule is read from each
// installed package's own `optionalDependencies`: if a package declares a
// sibling named for the target, that sibling has to be installed.

const SUPPORTED_PLATFORMS = ['linux', 'darwin', 'win32'];
const SUPPORTED_ARCHS = ['x64', 'arm64'];

/**
 * Packages whose per-platform sibling is legitimately absent.
 *
 * `@parcel/watcher` declares prebuilds for every target, and
 * `build/npm/postinstall.ts` deletes every one of them on purpose so the module
 * is compiled from source instead. Without this exemption the check would fail
 * on a perfectly healthy tree.
 */
const EXEMPT_BASE_PACKAGES = new Set([
	'@parcel/watcher'
]);

/**
 * The per-platform optional dependency `packageJson` declares for
 * `<platform>-<arch>`, or `undefined` when it declares none.
 *
 * Matching is on the exact `-<platform>-<arch>` suffix, so a `linux-x64` target
 * claims `@github/copilot-linux-x64` and deliberately not the neighbouring
 * `-linux-x64-musl` or `-linuxmusl-x64` variants, which are different targets.
 */
export function findTargetOptionalDep(packageJson: { optionalDependencies?: Record<string, string> }, platform: string, arch: string): string | undefined {
	const suffix = `-${platform}-${arch}`;
	return Object.keys(packageJson.optionalDependencies ?? {}).find(name => name.endsWith(suffix));
}

/**
 * Returns the name of the required per-platform package that is missing from
 * `nodeModulesDir`, or `undefined` when nothing is wrong.
 *
 * Only enforced when the base package itself is installed and actually declares
 * something for this target; otherwise the dependency was not requested here and
 * there is nothing to verify.
 */
export function findMissingNativeOptionalDep(nodeModulesDir: string, basePackage: string, platform: string, arch: string): string | undefined {
	const manifestPath = path.join(nodeModulesDir, basePackage, 'package.json');
	if (!fs.existsSync(manifestPath)) {
		return undefined;
	}

	let manifest: { optionalDependencies?: Record<string, string> };
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	} catch {
		// An unreadable manifest is not this check's business to diagnose.
		return undefined;
	}

	const required = findTargetOptionalDep(manifest, platform, arch);
	if (!required) {
		return undefined;
	}

	return fs.existsSync(path.join(nodeModulesDir, required)) ? undefined : required;
}

/**
 * The package names installed directly in `nodeModulesDir`, scoped ones
 * included (`@img/sharp-win32-x64` rather than `@img`).
 *
 * Only this top level is walked. Every package involved so far is hoisted to
 * one of the install roots, and recursing the whole tree would cost far more
 * than it catches.
 */
function installedPackages(nodeModulesDir: string): string[] {
	const names: string[] = [];
	for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) {
			continue;
		}
		if (entry.name.startsWith('@')) {
			for (const scoped of fs.readdirSync(path.join(nodeModulesDir, entry.name), { withFileTypes: true })) {
				if (scoped.isDirectory()) {
					names.push(`${entry.name}/${scoped.name}`);
				}
			}
		} else {
			names.push(entry.name);
		}
	}
	return names;
}

/**
 * Every `node_modules` a per-platform package could land in: each directory npm
 * installs into, the repo root included. The Claude agent SDK that pulls in
 * sharp lives under `extensions/copilot`, not at the root, so checking the root
 * alone would have missed #461.
 */
function nodeModulesDirs(repoRoot: string): string[] {
	return dirs
		.map(dir => path.join(repoRoot, dir, 'node_modules'))
		.filter(dir => fs.existsSync(dir));
}

/**
 * One message per problem found across every install location. An empty array
 * means the tree is consistent for that target.
 */
export function findNativeOptionalDepProblems(repoRoot: string, platform: string, arch: string): string[] {
	const problems: string[] = [];
	for (const nodeModulesDir of nodeModulesDirs(repoRoot)) {
		const where = path.relative(repoRoot, nodeModulesDir) || 'node_modules';
		for (const basePackage of installedPackages(nodeModulesDir)) {
			if (EXEMPT_BASE_PACKAGES.has(basePackage)) {
				continue;
			}
			const missing = findMissingNativeOptionalDep(nodeModulesDir, basePackage, platform, arch);
			if (missing) {
				problems.push(`${where}: '${basePackage}' declares '${missing}' for ${platform}-${arch}, but it is not installed`);
			}
		}
	}
	return problems;
}

// #region CLI entry point
//
// Run after `npm ci` with the TARGET platform and arch, which on a native build
// is simply the host:
//
//   node build/npm/checkNativeOptionalDeps.ts                 # host target
//   node build/npm/checkNativeOptionalDeps.ts win32 arm64     # cross-build

function isCliInvocation(): boolean {
	// `import.meta.filename` is already a real filesystem path; comparing it
	// directly to `process.argv[1]` works on Windows too.
	return import.meta.filename === process.argv[1];
}

function main(): void {
	const platform = process.argv[2] || process.platform;
	const arch = process.argv[3] || process.arch;

	if (!SUPPORTED_PLATFORMS.includes(platform) || !SUPPORTED_ARCHS.includes(arch)) {
		console.log(`Skipping native optional-dependency check on unsupported ${platform}-${arch}.`);
		return;
	}

	const repoRoot = path.join(import.meta.dirname, '..', '..');
	const problems = findNativeOptionalDepProblems(repoRoot, platform, arch);

	if (problems.length > 0) {
		console.error(`\x1b[1;31m*** Missing native optional-dependency packages for ${platform}-${arch} ***\x1b[0m`);
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		console.error(`
npm never fails an install over an optional dependency, so nothing went wrong
loudly — the package was simply skipped and this tree would ship without that
binary. Re-run 'npm ci' to restore it.

If you passed a target that is not this host, note that a cross-build is NOT
expected to satisfy this check from node_modules alone: packaging materializes
the target's package for the dependencies that ship (build/lib/sharp.ts,
build/lib/copilot.ts). Host tools in the tree stay host-architecture on purpose.`);
		process.exit(1);
	}

	console.log(`Verified native optional-dependency packages for ${platform}-${arch}.`);
}

if (isCliInvocation()) {
	main();
}

// #endregion
