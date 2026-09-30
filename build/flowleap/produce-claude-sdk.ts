/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * FlowLeap replacement for upstream's `build/agent-sdk/produce.ts` (PRD 0018 A7,
 * ADR 0009 decision 3). Upstream uploads each SDK tarball to its Azure CDN; we
 * attach the tarballs to the release instead, and the public release on
 * `abdullahatrash/flowleap-releases` serves them.
 *
 * Two modes:
 *
 *   produce (default)
 *     node build/flowleap/produce-claude-sdk.ts --tag=v0.5.0 --platforms=macos \
 *       --out=<dir> --results=<file>
 *     Builds one Claude SDK tarball per target with upstream's `buildOne()`,
 *     names each `claude-agent-sdk-<sdkVersion>-<sdkTarget>.tgz` in <dir>, and
 *     writes `{ "claude": { version, urlTemplate } }` to <file>. The packaging
 *     job points `AGENT_SDK_RESULTS_FILE` at <file>, and the existing gulp
 *     `packageTask` hook stamps it into the BUILT product.json as
 *     `agentSdks`. The checked-in product.json is never edited, and a build
 *     without the env var (every dev build) stays unstamped.
 *
 *   verify
 *     node build/flowleap/produce-claude-sdk.ts --verify=<built product.json> --results=<file>
 *     Fails unless the built product.json carries exactly the stamped entry.
 *
 * Only the `claude` SDK ships. Upstream's `codex` folder is ignored.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSdkTargetForBuild, getSdkVersion, parseFlags, type IAgentSdkResults, type VscodeBuildPlatform } from '../agent-sdk/common.ts';
import { buildOne } from '../agent-sdk/package.ts';

const SCRIPT = 'produce-claude-sdk.ts';
const SDK = 'claude';
const PUBLIC_REPO = 'abdullahatrash/flowleap-releases';

/** The release workflow's `platforms` input, mapped to VS Code build platforms. */
const PLATFORMS: Readonly<Record<string, readonly VscodeBuildPlatform[]>> = {
	macos: ['darwin'],
	windows: ['win32'],
	linux: ['linux'],
	all: ['darwin', 'win32', 'linux'],
};
const ARCHES = ['x64', 'arm64'] as const;

/** Release asset name. The `.tgz` suffix keeps it clear of every website download pattern. */
function assetName(sdkVersion: string, sdkTarget: string): string {
	return `claude-agent-sdk-${sdkVersion}-${sdkTarget}.tgz`;
}

/**
 * The URL template the runtime fills in (`agentSdkDownloader.ts` substitutes
 * `{sdkTarget}` with `format2`). GitHub answers with one redirect to its asset
 * host, which the request service follows.
 */
function urlTemplate(tag: string, sdkVersion: string): string {
	return `https://github.com/${PUBLIC_REPO}/releases/download/${tag}/${assetName(sdkVersion, '{sdkTarget}')}`;
}

function requireFlag(flags: Map<string, string>, name: string): string {
	const value = flags.get(name);
	if (!value) {
		throw new Error(`[${SCRIPT}] --${name}=<value> is required`);
	}
	return value;
}

async function produce(flags: Map<string, string>): Promise<void> {
	const tag = requireFlag(flags, 'tag');
	if (!/^v\d+\.\d+\.\d+/.test(tag)) {
		throw new Error(`[${SCRIPT}] --tag must look like vX.Y.Z (got '${tag}')`);
	}
	const platformsInput = flags.get('platforms') ?? 'all';
	const platforms = PLATFORMS[platformsInput];
	if (!platforms) {
		throw new Error(`[${SCRIPT}] --platforms must be one of ${Object.keys(PLATFORMS).join('|')} (got '${platformsInput}')`);
	}
	const outDir = path.resolve(requireFlag(flags, 'out'));
	const resultsFile = path.resolve(requireFlag(flags, 'results'));
	const stagingDir = path.join(outDir, '.staging');
	fs.mkdirSync(stagingDir, { recursive: true });

	const sdkVersion = getSdkVersion(SDK);
	const rows: string[] = [];
	for (const platform of platforms) {
		for (const arch of ARCHES) {
			const sdkTarget = getSdkTargetForBuild(platform, arch, SDK);
			if (!sdkTarget) {
				throw new Error(`[${SCRIPT}] no Claude SDK target for ${platform}/${arch}`);
			}
			const built = await buildOne({ sdk: SDK, sdkTarget, outDir: stagingDir });
			const dest = path.join(outDir, assetName(sdkVersion, sdkTarget));
			fs.renameSync(built.tgzPath, dest);
			rows.push(`${path.basename(dest)}  ${built.sizeBytes} bytes  sha256=${built.sha256}`);
		}
	}
	fs.rmSync(stagingDir, { recursive: true, force: true });

	const results: IAgentSdkResults = { [SDK]: { version: sdkVersion, urlTemplate: urlTemplate(tag, sdkVersion) } };
	fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
	fs.writeFileSync(resultsFile, JSON.stringify(results, null, '\t') + '\n');

	console.log(`[${SCRIPT}] Tarballs:\n  ${rows.join('\n  ')}`);
	console.log(`[${SCRIPT}] Wrote ${resultsFile}:\n${JSON.stringify(results, null, 2)}`);
}

function verify(flags: Map<string, string>): void {
	const productPath = requireFlag(flags, 'verify');
	const expected = JSON.parse(fs.readFileSync(requireFlag(flags, 'results'), 'utf8')) as IAgentSdkResults;
	const product = JSON.parse(fs.readFileSync(productPath, 'utf8')) as { agentSdks?: IAgentSdkResults };
	const actual = JSON.stringify(product.agentSdks ?? null);
	if (actual !== JSON.stringify(expected)) {
		throw new Error(`[${SCRIPT}] ${productPath} agentSdks is ${actual}, expected ${JSON.stringify(expected)}`);
	}
	console.log(`[${SCRIPT}] OK: ${productPath} carries agentSdks ${actual}`);
}

async function main(): Promise<void> {
	const flags = parseFlags(process.argv.slice(2));
	if (flags.has('verify')) {
		verify(flags);
	} else {
		await produce(flags);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
