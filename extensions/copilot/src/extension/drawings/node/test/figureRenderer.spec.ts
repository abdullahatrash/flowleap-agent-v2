/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DrawingScene } from '../../common/drawingScene';
import { renderFigure } from '../figureRenderer';

function fixture(name: string): DrawingScene {
	return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.scene.json`), 'utf8'));
}

function rules(findings: readonly { rule: string }[]): string[] {
	return findings.map(finding => finding.rule);
}

// The kernel loads once per file (about 0.6 s); the spring's helix sweep takes several seconds of hidden-line removal.
const KERNEL_TIMEOUT = 60_000;

describe('Patent Drawings engine: scene to FIG-N.svg', () => {

	for (const name of ['box-two-numerals', 'revolve-section', 'assembly-three-parts']) {
		it(`renders ${name} without findings`, async () => {
			const result = await renderFigure(fixture(name));
			await expect(`<!-- findings: ${JSON.stringify(rules(result.findings))} -->\n${result.svg}`).toMatchFileSnapshot(`fixtures/${name}.svg`);
		}, KERNEL_TIMEOUT);
	}

	it('builds every primitive and library part', async () => {
		const scene = fixture('every-kind');
		const results: Record<string, string[]> = {};
		for (const part of scene.parts) {
			const result = await renderFigure({ ...scene, parts: [part], numerals: scene.numerals.filter(port => port.part === part.id) });
			results[part.id] = result.svg ? rules(result.findings) : ['no svg', ...rules(result.findings)];
		}
		expect(results).toEqual(Object.fromEntries(scene.parts.map(part => [part.id, []])));
	}, KERNEL_TIMEOUT);

	it('the code escape hatch is refused unless the caller opts in', async () => {
		const scene = {
			figure: 'FIG-5',
			camera: 'front',
			parts: [{ id: 'cam', shape: { kind: 'code', code: 'return replicad.makeCylinder(10, 5, [0, 0, 0], [0, 0, 1]).cut(replicad.makeBox([-2, -2, 0], [2, 2, 5]));' } }],
			numerals: [{ numeral: '80', part: 'cam', face: 'body', point: [10, 0, 2.5] }],
		};
		const refused = await renderFigure(scene);
		const allowed = await renderFigure(scene, { allowCode: true });
		const escape = await renderFigure({ ...scene, parts: [{ id: 'cam', shape: { kind: 'code', code: 'return process.exit(1);' } }] }, { allowCode: true });
		expect({ refused: rules(refused.findings), allowed: [allowed.svg !== undefined, ...rules(allowed.findings)], escape: rules(escape.findings) }).toEqual({
			refused: ['code-not-allowed'],
			allowed: [true],
			escape: ['scene-build'],
		});
	}, KERNEL_TIMEOUT);

	it('a port point off its part gives lead-line-off-part', async () => {
		const scene = fixture('box-two-numerals');
		const result = await renderFigure({ ...scene, numerals: [{ numeral: '10', part: 'housing', face: 'front', point: [200, -50, 10] }] });
		expect(rules(result.findings)).toEqual(['lead-line-off-part']);
	}, KERNEL_TIMEOUT);
});
