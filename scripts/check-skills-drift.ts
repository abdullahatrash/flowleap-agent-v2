/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Drift check: every skill directory listed as a "mirror" in
// scripts/skills-drift-manifest.json must be byte-for-byte identical (every
// file, not just SKILL.md) to its canonical directory in flowleap-cli at the
// pinned ref. Canonical skill content lives upstream; the bundled copies
// under src/vs/sessions/skills/ are vendored snapshots (see
// scripts/vendor-patent-skills.ts). Editing a vendored skill directory by
// hand instead of re-vendoring makes this check fail.
//
// "adaptation" and "app-only" entries in the manifest are excluded by
// construction: this check never looks at them. That is what lets the
// typed-tool VS Code panel-chat skills (extensions/copilot/assets/skills/*)
// and the dev-workflow skills (src/vs/sessions/skills/{commit,sync,...})
// diverge from flowleap-cli on purpose without tripping drift.
//
// Comparison method: rather than an HTTP fetch per file (which cannot see a
// canonical directory listing without extra API calls), this script reads
// the canonical tree straight out of git — via a local checkout of
// flowleap-cli, exactly like scripts/vendor-patent-skills.ts. Locally this
// defaults to a sibling checkout (`../flowleap-cli`, override with
// FLOWLEAP_CLI_DIR); in CI a step checks out flowleap-cli at the pinned ref
// alongside this repo so no network call happens at check time. The
// checkout does not need to *be* the pinned ref — `git show <ref>:<path>`
// and `git ls-tree <ref>` read straight out of the object database, so any
// checkout that has that commit reachable (e.g. a shallow clone pinned to
// that exact tag) works.
//
// Usage:
//   npx tsx scripts/check-skills-drift.ts                  compare mirrors to the pinned ref
//   npx tsx scripts/check-skills-drift.ts --require-source  treat "no local flowleap-cli checkout" as a failure (CI)

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'scripts', 'skills-drift-manifest.json');
const SOURCE_REPO = process.env['FLOWLEAP_CLI_DIR'] ?? path.resolve(ROOT, '..', 'flowleap-cli');

interface IMirrorEntry {
	readonly bundledPath: string;
	readonly canonicalPath: string;
}

interface IDriftManifest {
	readonly canonicalRepo: string;
	readonly ref: string;
	readonly refDisplayName?: string;
	readonly mirrors: readonly IMirrorEntry[];
}

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

function git(args: string[]): string {
	// Pipe stderr instead of inheriting it: several call sites intentionally
	// catch a failing git invocation (missing ref, not a repo) and turn it
	// into a warning of their own — git's own "fatal: ..." must not leak to
	// the terminal in those expected-failure paths.
	return execFileSync('git', args, { cwd: SOURCE_REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Recursively lists files under `dir`, as posix paths relative to `root` (defaults to `dir`), skipping .DS_Store. */
function listFilesRecursive(dir: string, root: string = dir): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === '.DS_Store') {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listFilesRecursive(full, root));
		} else if (entry.isFile()) {
			out.push(toPosix(path.relative(root, full)));
		}
	}
	return out;
}

// path.relative returns platform separators on Windows; normalize to posix
// for stable comparison/reporting regardless of OS.
function toPosix(p: string): string {
	return p.split('\\').join('/');
}

function main(): void {
	const args = process.argv.slice(2);
	const requireSource = args.includes('--require-source');

	const manifest: IDriftManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
	const { canonicalRepo, ref, mirrors } = manifest;
	if (!canonicalRepo || !ref || !Array.isArray(mirrors)) {
		fail(`${MANIFEST_PATH}: must define 'canonicalRepo', 'ref', and a 'mirrors' array`);
	}

	if (!fs.existsSync(SOURCE_REPO)) {
		const msg = `no local checkout of ${canonicalRepo} found at ${SOURCE_REPO} (set FLOWLEAP_CLI_DIR, or checkout ${canonicalRepo}@${manifest.refDisplayName ?? ref} alongside this repo)`;
		if (requireSource) {
			fail(msg);
		}
		console.warn(`SKIP: ${msg} — drift NOT checked. Pass --require-source in CI.`);
		process.exit(0);
	}

	let refExists = true;
	try {
		git(['cat-file', '-e', `${ref}^{commit}`]);
	} catch {
		refExists = false;
	}
	if (!refExists) {
		const msg = `${SOURCE_REPO} does not have ${ref} reachable — fetch it (git fetch --tags, or check out that ref) before re-running`;
		if (requireSource) {
			fail(msg);
		}
		console.warn(`SKIP: ${msg} — drift NOT checked. Pass --require-source in CI.`);
		process.exit(0);
	}

	console.log(`Checking ${mirrors.length} mirrored skill director${mirrors.length === 1 ? 'y' : 'ies'} against ${canonicalRepo}@${manifest.refDisplayName ?? ref} ...`);

	const drift: string[] = [];
	for (const { bundledPath, canonicalPath } of mirrors) {
		const bundledDir = path.join(ROOT, bundledPath);
		if (!fs.existsSync(bundledDir)) {
			drift.push(`${bundledPath}: bundled directory is missing`);
			continue;
		}

		let canonicalFiles: string[];
		try {
			// git always reports posix-style paths prefixed with canonicalPath; strip
			// the prefix by hand rather than via path.relative so this stays correct
			// regardless of the host OS's path separator.
			const prefix = `${canonicalPath}/`;
			canonicalFiles = git(['ls-tree', '-r', '--name-only', ref, '--', canonicalPath])
				.split('\n')
				.filter(Boolean)
				.map(p => p.startsWith(prefix) ? p.slice(prefix.length) : p);
		} catch (err) {
			drift.push(`${bundledPath}: could not list ${canonicalPath} at ${ref} in ${SOURCE_REPO} (${(err as Error).message.trim()})`);
			continue;
		}
		if (canonicalFiles.length === 0) {
			drift.push(`${bundledPath}: ${canonicalPath} has no files at ${ref} (renamed or removed upstream?)`);
			continue;
		}

		const bundledFiles = listFilesRecursive(bundledDir).map(toPosix);

		const canonicalSet = new Set(canonicalFiles);
		const bundledSet = new Set(bundledFiles);

		for (const f of bundledFiles) {
			if (!canonicalSet.has(f)) {
				drift.push(`${bundledPath}/${f}: not present in ${canonicalPath} at ${ref} — stale file, re-vendor`);
			}
		}
		for (const f of canonicalFiles) {
			if (!bundledSet.has(f)) {
				drift.push(`${bundledPath}/${f}: missing — present in ${canonicalPath} at ${ref} but not vendored`);
			}
		}

		for (const f of canonicalFiles) {
			if (!bundledSet.has(f)) {
				continue; // already reported as missing above
			}
			let canonicalContent: string;
			try {
				canonicalContent = git(['show', `${ref}:${path.posix.join(canonicalPath, f)}`]);
			} catch (err) {
				drift.push(`${bundledPath}/${f}: could not read canonical content (${(err as Error).message.trim()})`);
				continue;
			}
			const bundledContent = fs.readFileSync(path.join(bundledDir, ...f.split('/')), 'utf8');
			if (bundledContent !== canonicalContent) {
				drift.push(`${bundledPath}/${f}: differs from ${canonicalPath}/${f} at ${ref} — re-vendor, do not hand-edit`);
			}
		}
	}

	if (drift.length > 0) {
		console.error(`\nDrift check FAILED with ${drift.length} issue(s):`);
		for (const d of drift) {
			console.error(`  - ${d}`);
		}
		console.error(`\nTo fix: re-run 'npx tsx scripts/vendor-patent-skills.ts <skill-name>...' (or --all) with FLOWLEAP_CLI_DIR pointed at a clean ${canonicalRepo} checkout, then bump 'ref'/'refDisplayName' in scripts/skills-drift-manifest.json to match scripts/vendor-patent-skills.ts's recorded commit.`);
		process.exit(1);
	}
	console.log(`Drift check passed: all ${mirrors.length} mirrored skill directories match ${canonicalRepo}@${manifest.refDisplayName ?? ref}.`);
}

main();
