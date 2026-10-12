/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { checkFigureSvgFaults, checkSceneFaults, DrawingFinding } from '../drawingFaults';
import type { DrawingScene } from '../drawingScene';
import { validateScene } from '../sceneValidator';

function rules(findings: readonly DrawingFinding[]): string[] {
	return findings.map(finding => finding.rule);
}

/** A 40 mm square part "p" from (10, 10) to (50, 50). */
const SQUARE = '<path class="edge" data-part="p" d="M10 10 L50 10 L50 50 L10 50 Z" stroke="#000" stroke-width="0.4" fill="none"/>';

/** A lead line from (x1, y1) beside the numeral to (x2, y2) on the part, written as `M x1 y1 L x2 y2`. */
function lead(numeral: string, d: string, part = 'p'): string {
	const [x1, y1, x2, y2] = d.replace(/[ML]/g, ' ').trim().split(/\s+/);
	return `<line class="lead" data-numeral="${numeral}" data-part="${part}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="0.2"/>`;
}

function numeral(text: string, x: number, y: number, options: { fontSize?: number; part?: string; surface?: boolean } = {}): string {
	return `<text class="numeral" data-numeral="${text}" data-part="${options.part ?? 'p'}"${options.surface ? ' data-surface="true"' : ''} x="${x}" y="${y}" font-family="sans-serif" font-size="${options.fontSize ?? 4.5}" text-anchor="middle" fill="#000">${text}</text>`;
}

function svg(...elements: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80" data-figure="1" data-kind="3d">\n${elements.join('\n')}\n</svg>\n`;
}

/** Numeral 10 right of the square, its lead line from beside it to the right edge. */
const CLEAN = [SQUARE, lead('10', 'M66.7 30 L50 30'), numeral('10', 70, 32)];

function scene(overrides: Partial<DrawingScene>): DrawingScene {
	return {
		figure: 'FIG-1',
		camera: 'isometric',
		parts: [{ id: 'housing', name: 'housing', shape: { kind: 'box', size: [10, 10, 10] } }],
		numerals: [{ numeral: '10', part: 'housing', face: 'top' }],
		...overrides,
	};
}

describe('Patent Drawings mechanical fault list', () => {

	it('a clean figure has no findings', () => {
		expect(rules(checkFigureSvgFaults(svg(...CLEAN)))).toEqual([]);
	});

	it('part without a numeral', () => {
		expect(rules(checkSceneFaults(scene({ parts: [...scene({}).parts, { id: 'lid', shape: { kind: 'box', size: [10, 10, 2] } }] })))).toEqual(['part-without-numeral']);
	});

	it('numeral without a port', () => {
		expect(rules(checkSceneFaults(scene({ numerals: [{ numeral: '10', part: 'housing', face: 'flange' }] })))).toEqual(['numeral-without-port']);
	});

	it('numeral not in the allowed set', () => {
		expect(rules(checkSceneFaults(scene({ numerals: [{ numeral: '14', part: 'housing', face: 'top' }] }), ['10', '12']))).toEqual(['numeral-not-allowed']);
	});

	it('one numeral on two different parts', () => {
		const parts = [...scene({}).parts, { id: 'lid', name: 'lid', shape: { kind: 'box' as const, size: [10, 10, 2] as const } }];
		expect(rules(checkSceneFaults(scene({ parts, numerals: [{ numeral: '10', part: 'housing', face: 'top' }, { numeral: '10', part: 'lid', face: 'top' }] })))).toEqual(['numeral-two-parts']);
	});

	it('crossing lead lines', () => {
		expect(rules(checkFigureSvgFaults(svg(SQUARE, lead('10', 'M66.7 30 L30 45'), numeral('10', 70, 32), lead('12', 'M66.7 46 L30 20'), numeral('12', 70, 48))))).toEqual(['lead-lines-cross']);
	});

	it('lead line ending off its part', () => {
		expect(rules(checkFigureSvgFaults(svg(SQUARE, lead('10', 'M66.7 30 L56 30'), numeral('10', 70, 32))))).toEqual(['lead-line-off-part']);
	});

	it('lead line that does not start beside its numeral', () => {
		expect(rules(checkFigureSvgFaults(svg(SQUARE, lead('10', 'M60 30 L50 30'), numeral('10', 70, 32))))).toEqual(['lead-line-far-from-numeral']);
	});

	it('numeral without a lead line and not underlined', () => {
		expect(rules(checkFigureSvgFaults(svg(SQUARE, numeral('10', 70, 32))))).toEqual(['lead-line-missing']);
	});

	it('glyph under 3.2 mm', () => {
		expect(rules(checkFigureSvgFaults(svg(SQUARE, lead('10', 'M67.5 30 L50 30'), numeral('10', 70, 32, { fontSize: 3 }))))).toEqual(['glyph-too-small']);
	});

	it('text beyond keywords', () => {
		expect(rules(checkFigureSvgFaults(svg(...CLEAN, '<text x="30" y="70" font-size="4.5">scale 1:2 actual size</text>')))).toEqual(['text-beyond-keywords']);
	});

	it('numerals that overlap', () => {
		expect(rules(checkFigureSvgFaults(svg(...CLEAN, lead('12', 'M74.5 33.8 L45 49'), numeral('12', 74.5, 33))))).toEqual(['numeral-overlap']);
	});

	it('numeral on a drawn line', () => {
		expect(rules(checkFigureSvgFaults(svg(...CLEAN, '<line class="edge" data-part="p" x1="60" y1="30.5" x2="80" y2="30.5" stroke="#000" stroke-width="0.4"/>')))).toEqual(['numeral-on-line']);
	});

	it('a diagram SVG runs a subset of checks without parts or a kernel', () => {
		const diagram = svg('<path class="edge" d="M10 10 L50 10 L50 50 L10 50 Z" stroke="#000" stroke-width="0.4" fill="none"/>', lead('10', 'M66.7 30 L50 30', ''), numeral('10', 70, 32, { fontSize: 3 }), '<text x="30" y="70" font-size="4.5">open the valve now</text>');
		expect(rules(checkFigureSvgFaults(diagram, { checks: ['lead-lines-cross', 'glyph-too-small', 'text-beyond-keywords'] }))).toEqual(['glyph-too-small', 'text-beyond-keywords']);
	});

	it('scene validator: structural errors name the path', () => {
		const result = validateScene({ figure: 'Figure 1', camera: 'perspective', parts: [{ id: 'a', shape: { kind: 'box', size: [1, -1, 1] } }, { id: 'a', shape: { kind: 'widget' } }], numerals: [{ numeral: 'ten', part: 'a', face: 'top' }] });
		expect(result.findings.map(finding => `${finding.rule}: ${finding.message}`)).toEqual([
			'scene-schema: figure: must be "FIG-N", e.g. "FIG-1"',
			'scene-schema: camera: must be one of isometric, front, top, side',
			'scene-schema: parts[0].shape.size[1]: must be a positive number',
			'scene-schema: parts[1].id: duplicate part id "a"',
			'scene-schema: parts[1].shape.kind: unknown kind "widget" (primitives: box, cylinder, extrudedPolygon, revolve, tube; library: fastener, spring, gear, bearing, shaft, pipe, motor; code)',
			'scene-schema: numerals[0].numeral: must be a reference numeral such as "10" or "12a"',
		]);
	});
});
