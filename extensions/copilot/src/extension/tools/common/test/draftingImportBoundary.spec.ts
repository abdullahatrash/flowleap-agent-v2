/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * One direction only (#798): the drawings engine depends on the drafting validators, never the
 * reverse. What drafting needs of the drawings engine (the Figure rule ids) lives in
 * `drafting/figureRules.ts`. This spec fails when a file under `tools/common/drafting` imports
 * from `drawings/`.
 */

const DRAFTING = path.resolve(__dirname, '../drafting');

const importPattern = /\bfrom\s+'(?<specifier>[^']+)'|\bimport\(\s*'(?<dynamic>[^']+)'\s*\)/g;

/** Every `.ts` file under a folder, recursively, relative to it. */
function sourceFiles(folder: string, prefix = ''): string[] {
	return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			return sourceFiles(path.join(folder, entry.name), relative);
		}
		return entry.name.endsWith('.ts') ? [relative] : [];
	});
}

describe('drafting import boundary', () => {
	it('no file under tools/common/drafting imports from drawings/', () => {
		const offenders = sourceFiles(DRAFTING).flatMap(file => {
			const text = readFileSync(path.join(DRAFTING, file), 'utf8');
			return [...text.matchAll(importPattern)]
				.map(match => match.groups?.specifier ?? match.groups?.dynamic ?? '')
				.filter(specifier => /(^|\/)drawings\//.test(specifier))
				.map(specifier => `${file}: ${specifier}`);
		});
		expect(offenders).toEqual([]);
	});
});
