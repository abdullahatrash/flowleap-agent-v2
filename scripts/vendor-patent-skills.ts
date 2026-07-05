/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Vendors the FlowLeap patent skill set from the sibling `flowleap-cli` repo
// (the skills' source of truth, version-locked to the CLI) into
// `src/vs/sessions/skills/`, where the Agents app discovers them as built-in
// skills and forwards them to Claude sessions as SDK plugins. Run via:
//
//   npx tsx scripts/vendor-patent-skills.ts <skill-name>...
//   npx tsx scripts/vendor-patent-skills.ts --all
//
// The source location defaults to `../flowleap-cli` next to this repo and can
// be overridden with the FLOWLEAP_CLI_DIR environment variable.
//
// Each skill directory is copied verbatim (all files, not only SKILL.md — the
// build resource globs ship the full directory). The copy is a deterministic
// snapshot: re-running against the same source commit produces no diff, and
// the vendored copy must only ever change through this script. The manifest
// `src/vs/sessions/skills/.vendored-patent-skills.json` records the source
// commit and the vendored skill names.
//
// Validations:
//   1. `SKILL.md` must exist and its frontmatter `name` must equal the folder
//      name — built-in skill discovery silently skips mismatches.
//   2. The source repo should be clean; a dirty tree produces a warning since
//      the recorded commit would not reproduce the snapshot.
//
// Coexistence with user/workspace skills: a user-level (`~/.claude/skills`)
// or workspace-level skill with the same name shadows the bundled built-in of
// that name, per the SDK's and the prompts service's normal precedence. This
// is intentional — there is no dedup layer; the built-in reappears when the
// user copy is removed.

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const SOURCE_REPO = process.env['FLOWLEAP_CLI_DIR'] ?? path.resolve(ROOT, '..', 'flowleap-cli');
const SOURCE_SKILLS = path.join(SOURCE_REPO, 'skills');
const TARGET_SKILLS = path.join(ROOT, 'src', 'vs', 'sessions', 'skills');
// Not dot-prefixed: the build resource globs skip dotfiles, and the manifest
// should ship with the snapshot it describes.
const MANIFEST_PATH = path.join(TARGET_SKILLS, 'vendored-patent-skills.json');

interface IVendorManifest {
	readonly description: string;
	source: string;
	commit: string;
	skills: string[];
}

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

function parseFrontmatterName(skillFile: string): string | undefined {
	const content = fs.readFileSync(skillFile, 'utf8');
	const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!frontmatter) {
		return undefined;
	}
	const nameLine = frontmatter[1].match(/^name:\s*(?<quote>["']?)(?<name>.+?)\k<quote>\s*$/m);
	return nameLine?.groups?.['name'];
}

function copySkill(name: string): number {
	const sourceDir = path.join(SOURCE_SKILLS, name);
	const targetDir = path.join(TARGET_SKILLS, name);
	const skillFile = path.join(sourceDir, 'SKILL.md');

	if (!fs.existsSync(skillFile)) {
		fail(`${name}: no SKILL.md in ${sourceDir}`);
	}
	const frontmatterName = parseFrontmatterName(skillFile);
	if (frontmatterName !== name) {
		fail(`${name}: frontmatter name '${frontmatterName}' does not match the folder name — built-in discovery would skip this skill`);
	}

	fs.rmSync(targetDir, { recursive: true, force: true });
	fs.cpSync(sourceDir, targetDir, {
		recursive: true,
		filter: source => path.basename(source) !== '.DS_Store',
	});

	let fileCount = 0;
	for (const entry of fs.readdirSync(targetDir, { recursive: true, withFileTypes: true })) {
		if (entry.isFile()) {
			fileCount++;
		}
	}
	return fileCount;
}

function main(): void {
	const args = process.argv.slice(2);
	if (args.length === 0) {
		fail('usage: npx tsx scripts/vendor-patent-skills.ts <skill-name>... | --all');
	}
	if (!fs.existsSync(SOURCE_SKILLS)) {
		fail(`source skills directory not found: ${SOURCE_SKILLS} (checkout flowleap-cli next to this repo or set FLOWLEAP_CLI_DIR)`);
	}

	const available = fs.readdirSync(SOURCE_SKILLS, { withFileTypes: true })
		.filter(e => e.isDirectory())
		.map(e => e.name)
		.sort();
	const requested = args.includes('--all') ? available : args;

	for (const name of requested) {
		if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
			fail(`invalid skill name: ${name}`);
		}
		if (!available.includes(name)) {
			fail(`unknown skill '${name}' — available: ${available.join(', ')}`);
		}
	}

	const dirty = execSync('git status --porcelain -- skills', { cwd: SOURCE_REPO, encoding: 'utf8' }).trim();
	if (dirty) {
		console.warn(`warning: ${SOURCE_REPO} has uncommitted skill changes — the recorded commit will not reproduce this snapshot`);
	}
	const commit = execSync('git rev-parse HEAD', { cwd: SOURCE_REPO, encoding: 'utf8' }).trim();

	for (const name of requested) {
		const fileCount = copySkill(name);
		console.log(`vendored ${name} (${fileCount} file${fileCount === 1 ? '' : 's'})`);
	}

	const previous: Partial<IVendorManifest> = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : {};
	const manifest: IVendorManifest = {
		description: 'Vendored snapshot of the FlowLeap patent skills. Do not edit these skill directories by hand; re-run scripts/vendor-patent-skills.ts to update them.',
		source: 'flowleap-cli/skills',
		commit,
		skills: [...new Set([...(previous.skills ?? []), ...requested])].sort(),
	};
	fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`manifest updated (${manifest.skills.length} vendored skill${manifest.skills.length === 1 ? '' : 's'} @ ${commit.slice(0, 10)})`);
}

main();
