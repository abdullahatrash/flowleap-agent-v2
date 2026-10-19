/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The `patent-drawings` skill exists twice, by hand: the editor copy calls the typed tools, the
 * Agents Window copy runs the drawings CLI. `scripts/skills-drift-manifest.json` lists both as
 * app-only, so the drift check ignores them. This spec keeps them in step: the reference files
 * are the same and the two SKILL.md files have the same steps and completion criteria.
 */

/** The repository root: eight folders up from this test folder. */
const REPO_ROOT = path.resolve(__dirname, '../../../../../../../..');
const EDITOR = path.join(REPO_ROOT, 'extensions/copilot/assets/skills/patent-drawings');
const SESSIONS = path.join(REPO_ROOT, 'src/vs/sessions/skills/patent-drawings');

/**
 * The only allowed wording differences, editor text to Agents Window text: a typed tool name
 * and its CLI command. Every other byte must be the same. Add a pair here only for a new
 * tool-versus-CLI phrase, never to hide a content change.
 */
const SURFACE_WORDING: readonly (readonly [editor: string, sessions: string])[] = [
	['`propose_figure_part`', 'the `propose` command'],
	['`build_drawing_set` refuses', 'The `build` command refuses'],
	['Write the input per Figure', 'Write the input file per Figure'],
	['has an input whose numerals', 'has an input file whose numerals'],
	['`newCycle: true`', '`--new-cycle`'],
];

/** Editor text in Agents Window wording. */
function toSessionsWording(text: string): string {
	return SURFACE_WORDING.reduce((result, [editor, sessions]) => result.split(editor).join(sessions), text);
}

/** The file name and the first line where two texts differ, or `undefined` when they are equal. */
function firstDifference(name: string, editor: string, sessions: string): string | undefined {
	const left = editor.split('\n');
	const right = sessions.split('\n');
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		if (left[index] !== right[index]) {
			return `${name} line ${index + 1}:\n  editor:   ${left[index] ?? '<end of file>'}\n  sessions: ${right[index] ?? '<end of file>'}`;
		}
	}
	return undefined;
}

/** The `## Step N:` headings and the `Done when` paragraphs of a SKILL.md, in order. */
function stepOutline(skill: string): { headings: string[]; doneWhen: string[] } {
	const headings = skill.split('\n').filter(line => /^## Step \d+:/.test(line));
	const doneWhen = skill.split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(paragraph => paragraph.startsWith('Done when')).map(paragraph => paragraph.replace(/\s+/g, ' '));
	return { headings, doneWhen };
}

describe('patent-drawings skill copies', () => {
	it('have the same reference files', () => {
		const editorFiles = readdirSync(path.join(EDITOR, 'references')).sort();
		const sessionsFiles = readdirSync(path.join(SESSIONS, 'references')).sort();
		const differences = editorFiles.flatMap(name => {
			if (!sessionsFiles.includes(name)) {
				return [`${name}: missing in the Agents Window copy`];
			}
			const difference = firstDifference(name,
				toSessionsWording(readFileSync(path.join(EDITOR, 'references', name), 'utf8')),
				readFileSync(path.join(SESSIONS, 'references', name), 'utf8'));
			return difference ? [difference] : [];
		});
		expect({ editorFiles, sessionsFiles, differences }).toEqual({ editorFiles: sessionsFiles, sessionsFiles, differences: [] });
	});

	it('have the same steps and completion criteria in SKILL.md', () => {
		const editor = stepOutline(toSessionsWording(readFileSync(path.join(EDITOR, 'SKILL.md'), 'utf8')));
		const sessions = stepOutline(readFileSync(path.join(SESSIONS, 'SKILL.md'), 'utf8'));
		expect(editor).toEqual(sessions);
	});
});
