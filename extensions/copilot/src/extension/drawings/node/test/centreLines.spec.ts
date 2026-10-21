/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { DrawingScene, NumeralPort } from '../../common/scene/drawingScene';
import { renderFigure } from '../kernel/figureRenderer';

/**
 * Chain centre lines (#801, the half of #693 that did not ship): `centreLine: true` on an axis
 * port draws a thin long-dash short-dash line through the port across the part. The cam of
 * FIG. 4 (bicycle matter) and the two pins of the D7 FIG. 2 (pipe clamp, the scene of the live
 * acceptance run) are both seen along their axis, so each gets two crossing centre lines.
 */
function fixture(file: string): DrawingScene {
	return JSON.parse(readFileSync(path.join(__dirname, file), 'utf8'));
}

/** The scene with `centreLine: true` on the given numerals. */
function withCentreLines(scene: DrawingScene, numerals: readonly string[]): DrawingScene {
	return { ...scene, numerals: scene.numerals.map((port): NumeralPort => numerals.includes(port.numeral) ? { ...port, centreLine: true } : port) };
}

/** The chain paths of a written Figure SVG: numeral, dash pattern and the segment. */
function chainPaths(svg: string): { numeral: string; dashes: string; d: string }[] {
	return [...svg.matchAll(/<path class="centre-line" data-numeral="(?<numeral>[^"]+)"[^>]* stroke-dasharray="(?<dashes>[^"]+)"[^>]* d="(?<d>[^"]+)"/g)].map(match => ({ numeral: match.groups!.numeral, dashes: match.groups!.dashes, d: match.groups!.d }));
}

/** The lead lines of a written Figure SVG, as written. */
function leads(svg: string): string[] {
	return svg.match(/<line class="lead"[^>]*>/g) ?? [];
}

const KERNEL_TIMEOUT = 90_000;

describe('Chain centre lines (#801)', () => {

	it('154 on the cam axis of FIG. 4 gets two crossing chain lines; the lead checks do not change', async () => {
		const scene = fixture('fixtures/fig4-cam-axis.scene.json');
		const before = await renderFigure(scene);
		const after = await renderFigure(withCentreLines(scene, ['154']));
		const svg = after.svg ?? '';
		const chains = chainPaths(svg);
		expect({
			findings: after.findings.map(finding => finding.rule),
			sameFindingsAsBefore: after.findings.map(finding => finding.rule).join() === before.findings.map(finding => finding.rule).join(),
			chains: chains.map(chain => `${chain.numeral} ${chain.dashes}`),
			horizontalAndVertical: chains.map(chain => chain.d.replace(/[ML]/g, '').trim().split(/\s+/).map(Number)).map(([x1, y1, x2, y2]) => y1 === y2 ? 'horizontal' : x1 === x2 ? 'vertical' : 'oblique'),
			leadCount: leads(svg).length,
			leadCountBefore: leads(before.svg ?? '').length,
		}).toEqual({
			findings: [],
			sameFindingsAsBefore: true,
			chains: ['154 8 1.5 3 1.5', '154 8 1.5 3 1.5'],
			horizontalAndVertical: ['horizontal', 'vertical'],
			leadCount: 5,
			leadCountBefore: 5,
		});
	}, KERNEL_TIMEOUT);

	it('the hinge pin 22 and the locking pin 34 of the D7 FIG. 2 get chain lines across their lugs; the leads of 22 and 34 do not move', async () => {
		const scene = fixture('../kernel/test/fixtures/pipe-clamp-section.scene.json');
		const before = await renderFigure(scene);
		const after = await renderFigure(withCentreLines(scene, ['22', '34']));
		const svg = after.svg ?? '';
		const own = (line: string) => /data-numeral="(?:22|34)"/.test(line);
		expect({
			findings: after.findings.map(finding => `${finding.severity} ${finding.rule}`),
			sameFindingsAsBefore: after.findings.map(finding => finding.rule).join() === before.findings.map(finding => finding.rule).join(),
			chains: chainPaths(svg).map(chain => `${chain.numeral} ${chain.dashes}`),
			pinLeads: leads(svg).filter(own),
			pinLeadsBefore: leads(before.svg ?? '').filter(own),
			leadCount: leads(svg).length,
		}).toEqual({
			findings: ['Note hatch-same-as-neighbour'], // The live scene's own hatch overrides; the same before and after.
			sameFindingsAsBefore: true,
			chains: ['22 8 1.5 3 1.5', '22 8 1.5 3 1.5', '34 8 1.5 3 1.5', '34 8 1.5 3 1.5'],
			pinLeads: leads(before.svg ?? '').filter(own),
			pinLeadsBefore: leads(before.svg ?? '').filter(own),
			leadCount: leads(before.svg ?? '').length,
		});
	}, KERNEL_TIMEOUT);
});
