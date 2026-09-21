/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { create } from 'tar';
import { prepareSharpPlatformPackages, sharpPackagesFor, toSharpPlatformArch } from '../sharp.ts';

/**
 * A `node_modules` root holding the agent SDK that declares the sharp packages,
 * plus the lockfile entry the materializer reads the version and integrity from.
 */
function createFixture(sharpPackage: string, options: { withSdk?: boolean } = {}): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sharp-test-'));
	const nodeModules = path.join(root, 'node_modules');

	if (options.withSdk !== false) {
		fs.mkdirSync(path.join(nodeModules, '@anthropic-ai', 'claude-agent-sdk'), { recursive: true });
	} else {
		fs.mkdirSync(nodeModules, { recursive: true });
	}

	const packages: Record<string, { version: string }> = {};
	for (const name of [sharpPackage, sharpPackage.replace('@img/sharp-', '@img/sharp-libvips-')]) {
		packages[`node_modules/${name}`] = { version: '0.34.5' };
	}
	fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages }));

	return root;
}

/** Stands in for `npm pack`, so the test never reaches the network. */
function packFixture(packageName: string, version: string, tempDir: string): string {
	const contents = fs.mkdtempSync(path.join(os.tmpdir(), 'sharp-pack-'));
	const inner = path.join(contents, 'package');
	fs.mkdirSync(path.join(inner, 'lib'), { recursive: true });
	fs.writeFileSync(path.join(inner, 'package.json'), JSON.stringify({ name: packageName, version }));
	fs.writeFileSync(path.join(inner, 'lib', 'sharp.node'), 'binary');

	const tarball = path.join(tempDir, 'fixture.tgz');
	create({ gzip: true, cwd: contents, file: tarball, sync: true }, ['package']);
	return tarball;
}

suite('sharp', () => {

	test('maps build targets to the package @img actually publishes', () => {
		assert.deepStrictEqual([
			toSharpPlatformArch('win32', 'arm64'),
			toSharpPlatformArch('win32', 'x64'),
			toSharpPlatformArch('darwin', 'arm64'),
			toSharpPlatformArch('darwin', 'x64'),
			toSharpPlatformArch('linux', 'x64'),
			toSharpPlatformArch('alpine', 'arm64'),
			toSharpPlatformArch('linux', 'armhf'),
			toSharpPlatformArch('linux', 'ppc64le')
		], [
			'win32-arm64',
			'win32-x64',
			'darwin-arm64',
			'darwin-x64',
			'linux-x64',
			'linuxmusl-arm64',
			'linux-arm',
			undefined
		]);
	});

	test('materializes the target package when npm installed the host one', () => {
		const root = createFixture('@img/sharp-win32-arm64');
		const nodeModules = path.join(root, 'node_modules');
		// What a cross-build on an x64 runner actually produced.
		fs.mkdirSync(path.join(nodeModules, '@img', 'sharp-win32-x64'), { recursive: true });

		prepareSharpPlatformPackages('win32', 'arm64', nodeModules, { packPackage: packFixture });

		assert.strictEqual(fs.existsSync(path.join(nodeModules, '@img', 'sharp-win32-arm64', 'lib', 'sharp.node')), true);
		// win32 bundles libvips, so there must be no second package.
		assert.strictEqual(fs.existsSync(path.join(nodeModules, '@img', 'sharp-libvips-win32-arm64')), false);
	});

	test('does nothing when the agent SDK that declares sharp is absent', () => {
		const root = createFixture('@img/sharp-win32-arm64', { withSdk: false });
		const nodeModules = path.join(root, 'node_modules');

		prepareSharpPlatformPackages('win32', 'arm64', nodeModules, {
			packPackage: () => assert.fail('must not fetch anything when the SDK is not installed')
		});

		assert.strictEqual(fs.existsSync(path.join(nodeModules, '@img', 'sharp-win32-arm64')), false);
	});

	test('does nothing when the target packages are already installed', () => {
		const root = createFixture('@img/sharp-darwin-arm64');
		const nodeModules = path.join(root, 'node_modules');
		fs.mkdirSync(path.join(nodeModules, '@img', 'sharp-darwin-arm64'), { recursive: true });
		fs.mkdirSync(path.join(nodeModules, '@img', 'sharp-libvips-darwin-arm64'), { recursive: true });

		prepareSharpPlatformPackages('darwin', 'arm64', nodeModules, {
			packPackage: () => assert.fail('must not re-fetch an installed package')
		});
	});

	test('names the library package on darwin and linux, but not on win32', () => {
		assert.deepStrictEqual([
			sharpPackagesFor('win32-arm64'),
			sharpPackagesFor('darwin-x64'),
			sharpPackagesFor('linuxmusl-arm64')
		], [
			['@img/sharp-win32-arm64'],
			['@img/sharp-darwin-x64', '@img/sharp-libvips-darwin-x64'],
			['@img/sharp-linuxmusl-arm64', '@img/sharp-libvips-linuxmusl-arm64']
		]);
	});

	test('removes the host package so only the target architecture ships', () => {
		const root = createFixture('@img/sharp-win32-arm64');
		const nodeModules = path.join(root, 'node_modules');
		// What the x64 runner installed, and what used to ship inside the arm64 build.
		fs.mkdirSync(path.join(nodeModules, '@img', 'sharp-win32-x64', 'lib'), { recursive: true });

		prepareSharpPlatformPackages('win32', 'arm64', nodeModules, { packPackage: packFixture });

		assert.deepStrictEqual(fs.readdirSync(path.join(nodeModules, '@img')).sort(), ['sharp-win32-arm64']);
	});

	test('does nothing for a target sharp does not publish', () => {
		const root = createFixture('@img/sharp-linux-ppc64le');
		const nodeModules = path.join(root, 'node_modules');

		prepareSharpPlatformPackages('linux', 'ppc64le', nodeModules, {
			packPackage: () => assert.fail('must not fetch a package that does not exist')
		});
	});
});
