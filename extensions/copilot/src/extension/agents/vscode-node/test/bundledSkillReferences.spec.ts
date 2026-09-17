/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Hygiene of the bundled skill assets themselves, as opposed to the tool names their
 * bodies cite (patentToolReferences.spec.ts). Skills are assets, so nothing in the build
 * reads them: a pointer to a file that does not exist survives compilation and ships.
 */
const SKILLS_DIR = path.resolve(__dirname, '../../../../../assets/skills');

describe('bundled skill references', () => {
	const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
		.filter(entry => entry.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
		.map(entry => entry.name);

	it('resolves every file a skill body points at, in its own folder or a sibling skill', () => {
		// A context pointer to a file that does not exist teaches the agent to look for
		// material it can never load, and nothing else in the build notices: skills are
		// assets, so a dead link survives compilation and ships.
		const dangling = skillDirs.flatMap(name => {
			const body = fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
			// Two pointer shapes ship today: into the skill's own references/ folder, and
			// across to a sibling skill. Both are a path that must resolve on disk.
			return [...body.matchAll(/\]\((\.?\/?(?:references\/|\.\.\/)[^)#]+)\)/g)]
				.map(match => match[1])
				.filter(target => !fs.existsSync(path.resolve(SKILLS_DIR, name, target)))
				.map(target => `${name}: ${target}`);
		}).sort();
		expect({ scanned: skillDirs.length > 0, dangling }).toEqual({ scanned: true, dangling: [] });
	});

	it('keeps the decision-row example parseable as the format it teaches', () => {
		// The investigation record's worked rows ARE the format spec: an agent copies their
		// shape. A row with the wrong column count or an unknown status teaches that instead.
		const reference = fs.readFileSync(path.join(SKILLS_DIR, 'investigation-record', 'references', 'row-format.md'), 'utf8');
		const rows = reference.split('\n').filter(line => line.includes('\t'));
		const header = rows[0]?.split('\t');
		const problems = rows.slice(1).flatMap(row => {
			const cells = row.split('\t');
			const status = cells[4] ?? '';
			const known = status === 'settled' || status === 'unresolved' || status.startsWith('superseded by ');
			return [
				...(cells.length === header.length ? [] : [`${cells.length} cells, expected ${header.length}: ${cells[1]}`]),
				...(known ? [] : [`unknown status "${status}": ${cells[1]}`]),
			];
		});
		expect({ header, hasRows: rows.length > 1, problems })
			.toEqual({ header: ['when', 'call', 'why', 'evidence', 'status'], hasRows: true, problems: [] });
	});
});
