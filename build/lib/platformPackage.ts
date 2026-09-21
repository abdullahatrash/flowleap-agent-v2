/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { extract } from 'tar';

// Materializing a per-platform optional dependency for a CROSS-BUILT target.
//
// npm selects optional dependencies by matching each candidate's `cpu`/`os`
// fields against the npm config keys `cpu` and `os`, which default to the HOST.
// `npm_config_arch` does not affect that choice at all — it steers node-gyp and
// prebuild-install only. So an install on an x64 runner produces the x64
// platform package even when the build targets arm64.
//
// Forcing `npm_config_cpu`/`npm_config_os` at install time would fix the shipped
// packages and break the build, because the same keys also move the HOST tools
// in the tree — `@typescript/native-preview` (tsgo) above all, which packaging
// spawns. An arm64 tsgo cannot run on an x64 runner.
//
// So the target's package is fetched separately, after the host install, and
// only for the packages that actually ship. `@github/copilot` has worked this
// way for a while (build/lib/copilot.ts); this module is that mechanism made
// reusable so `@img/sharp` can use it too (#461).

interface NpmPackageLock {
	packages?: Record<string, {
		version?: string;
		integrity?: string;
	}>;
}

export interface IEnsurePlatformPackageOptions {
	/** Overridable for tests, which must not hit the network. */
	packPackage?: (packageName: string, version: string, tempDir: string) => string;
}

export function packPlatformPackage(packageName: string, version: string, tempDir: string): string {
	execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', `${packageName}@${version}`, '--pack-destination', tempDir, '--silent'], { stdio: 'pipe', shell: process.platform === 'win32' });

	const tarball = fs.readdirSync(tempDir).find(name => name.endsWith('.tgz'));
	if (!tarball) {
		throw new Error(`npm pack did not produce a tarball in ${tempDir}`);
	}

	return path.join(tempDir, tarball);
}

export function readNpmPackageLock(lockFilePath: string, context: string): NpmPackageLock {
	try {
		return JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
	} catch (err) {
		throw new Error(`[${context}] Failed to read ${lockFilePath}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export function verifyNpmIntegrity(tarballPath: string, integrity: string | undefined): void {
	if (!integrity) {
		return;
	}

	const sha512Integrity = integrity.split(/\s+/).find(entry => entry.startsWith('sha512-'));
	if (!sha512Integrity) {
		return;
	}

	const expected = sha512Integrity.slice('sha512-'.length);
	const actual = createHash('sha512').update(fs.readFileSync(tarballPath)).digest('base64');
	if (actual !== expected) {
		throw new Error(`integrity mismatch for ${tarballPath}`);
	}
}

/**
 * Ensures `packageName` is present in `nodeModulesRoot`, fetching it at the
 * version and integrity its lockfile pins when it is not.
 *
 * A no-op when the package is already there, so a native build never pays for
 * this. The version and the integrity hash both come from the lockfile beside
 * `nodeModulesRoot`, so a cross-build installs exactly what a host install of
 * the same tree would have.
 *
 * `context` only names the caller in error messages.
 */
export function ensurePlatformPackage(packageName: string, nodeModulesRoot: string, context: string, options: IEnsurePlatformPackageOptions = {}): void {
	const packageDir = path.join(nodeModulesRoot, ...packageName.split('/'));
	if (fs.existsSync(packageDir)) {
		return;
	}

	const lockFilePath = path.join(path.dirname(nodeModulesRoot), 'package-lock.json');
	const lockPackageKey = path.posix.join('node_modules', packageName);
	const lockPackage = readNpmPackageLock(lockFilePath, context).packages?.[lockPackageKey];
	if (!lockPackage?.version) {
		throw new Error(`[${context}] Missing ${lockPackageKey} in ${lockFilePath}. Run npm install to refresh the lockfile.`);
	}

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-platform-package-'));
	try {
		const tarballPath = (options.packPackage ?? packPlatformPackage)(packageName, lockPackage.version, tempDir);
		verifyNpmIntegrity(tarballPath, lockPackage.integrity);

		fs.mkdirSync(packageDir, { recursive: true });
		extract({ file: tarballPath, cwd: packageDir, strip: 1, sync: true });
		console.log(`[${context}] Materialized ${packageName}@${lockPackage.version} in ${packageDir}`);
	} catch (err) {
		fs.rmSync(packageDir, { recursive: true, force: true });
		throw new Error(`[${context}] Failed to materialize ${packageName}@${lockPackage.version}: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}
