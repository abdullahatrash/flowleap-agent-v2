/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { join } from '../../../base/common/path.js';
import { FileAccess } from '../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';

/**
 * Guards the vendored patent skill set (flowleap-*, persona-*, recipe-* under
 * `vs/sessions/skills`, snapshotted from the flowleap-cli repo by
 * `scripts/vendor-patent-skills.ts`) against the invariants that built-in skill
 * discovery (`AgenticPromptsService.discoverBuiltinSkills`) silently relies on:
 * every vendored skill directory has a `SKILL.md` whose frontmatter `name`
 * equals the folder name and carries a non-empty `description`. A violation is
 * skipped by discovery without an error, so a fresh install would quietly lose
 * the skill — this test makes that loud.
 */
suite('vendoredPatentSkills', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const skillsRoot = FileAccess.asFileUri('vs/sessions/skills').fsPath;
	const manifestPath = join(skillsRoot, 'vendored-patent-skills.json');

	function parseFrontmatter(skillFile: string): { name?: string; description?: string } {
		const content = fs.readFileSync(skillFile, 'utf8');
		const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (!frontmatter) {
			return {};
		}
		const field = (key: string) => frontmatter[1].match(new RegExp(`^${key}:\\s*(?<quote>["']?)(?<value>.+?)\\k<quote>\\s*$`, 'm'))?.groups?.['value'];
		return { name: field('name'), description: field('description') };
	}

	test('every vendored skill is discoverable as a built-in on a fresh install', () => {
		const manifest: { skills: string[] } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

		const discoverable = fs.readdirSync(skillsRoot, { withFileTypes: true })
			.filter(e => e.isDirectory())
			.map(e => e.name)
			.filter(name => {
				const { name: frontmatterName, description } = parseFrontmatter(join(skillsRoot, name, 'SKILL.md'));
				return frontmatterName === name && !!description;
			})
			.filter(name => manifest.skills.includes(name))
			.sort();

		assert.deepStrictEqual(discoverable, [...manifest.skills].sort(), 'every skill in the vendored manifest must exist under vs/sessions/skills and satisfy the built-in discovery contract (SKILL.md present, frontmatter name === folder name, non-empty description)');
		assert.ok(manifest.skills.length >= 22, `expected the full patent skill set (>= 22 skills), got ${manifest.skills.length}`);
	});
});
