/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { checkFigureSvgFaults, checkSceneFaults, DrawingFinding } from '../drawingFaults';
import type { DrawingScene, ScenePart, SectionPlane } from '../drawingScene';
import { isSectioned } from '../sceneGeometry';
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
	return `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80" data-figure="FIG-1" data-kind="3d">\n${elements.join('\n')}\n</svg>\n`;
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
		expect(rules(checkFigureSvgFaults(svg(SQUARE, lead('10', 'M66.7 30 L50 45'), numeral('10', 70, 32), lead('12', 'M66.7 46 L50 20'), numeral('12', 70, 48))))).toEqual(['lead-lines-cross']);
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
		expect(rules(checkFigureSvgFaults(svg(...CLEAN, lead('12', 'M74.5 33.8 L45 50'), numeral('12', 74.5, 33))))).toEqual(['numeral-overlap']);
	});

	it('numeral on a drawn line', () => {
		expect(rules(checkFigureSvgFaults(svg(...CLEAN, '<line class="edge" data-part="p" x1="60" y1="30.5" x2="80" y2="30.5" stroke="#000" stroke-width="0.4"/>')))).toEqual(['numeral-on-line']);
	});

	it('lead line that ends on no edge and no centre mark (#693)', () => {
		const mark = '<path class="mark" data-numeral="10" data-part="p" stroke-width="0.2" d="M28.5 30 L31.5 30 M30 28.5 L30 31.5"/>';
		expect({
			onNothing: rules(checkFigureSvgFaults(svg(SQUARE, lead('10', 'M66.7 30 L30 30'), numeral('10', 70, 32)))),
			onMarkArm: rules(checkFigureSvgFaults(svg(SQUARE, mark, lead('10', 'M66.7 40 L30 31.5'), numeral('10', 70, 42)))),
		}).toEqual({ onNothing: ['lead-ends-on-nothing'], onMarkArm: ['lead-crosses-outline'] }); // The 40 mm square has room for 10 inside, next to its mark (#701).
	});

	it('lead line that runs along a visible edge (#694)', () => {
		expect({
			alongTopEdge: rules(checkFigureSvgFaults(svg(SQUARE, lead('10', 'M66.7 10 L45 10'), numeral('10', 70, 12)))),
			atAnAngle: rules(checkFigureSvgFaults(svg(SQUARE, lead('10', 'M66.7 0 L45 10'), numeral('10', 70, 2)))),
		}).toEqual({ alongTopEdge: ['lead-along-edge'], atAnAngle: [] });
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
			'scene-schema: parts[1].shape.kind: unknown kind "widget" (primitives: box, cylinder, extrudedPolygon, revolve, tube; library: fastener, spring, gear, bearing, shaft, pipe, motor, cam; code)',
			'scene-schema: numerals[0].numeral: must be a reference numeral such as "10" or "12a"',
		]);
	});

	it('scene validator: sectioned and hatch take only the allowed values', () => {
		const part = (extra: object) => ({ id: 'p', shape: { kind: 'box', size: [1, 1, 1] }, ...extra });
		const result = validateScene({ figure: 'FIG-1', camera: 'front', parts: [part({ sectioned: 'no' }), { ...part({ hatch: { angle: 30, pitch: 5 } }), id: 'q' }, { ...part({ hatch: 'dense' }), id: 'r' }, { ...part({ sectioned: false, hatch: { angle: 135, pitch: 1.5 } }), id: 's' }], numerals: [] });
		expect(result.findings.map(finding => `${finding.rule}: ${finding.message}`)).toEqual([
			'scene-schema: parts[0].sectioned: must be true or false',
			'scene-schema: parts[1].hatch.angle: must be 45 or 135 (degrees)',
			'scene-schema: parts[1].hatch.pitch: must be a number from 1.5 to 3 (sheet mm)',
			'scene-schema: parts[2].hatch: must be { angle?, pitch? }',
		]);
	});

	it('shafts, fasteners and springs stay unsectioned only when the plane runs along their axis', () => {
		const plane: SectionPlane = { origin: [0, 0, 0], normal: 'y' };
		const alongX = { rotate: [0, 90, 0] as const };
		const parts: Record<string, ScenePart> = {
			shaftAlong: { id: 'a', shape: { kind: 'shaft', steps: [{ diameter: 8, length: 40 }] }, placement: alongX },
			shaftAcross: { id: 'b', shape: { kind: 'shaft', steps: [{ diameter: 8, length: 40 }] }, placement: { rotate: [90, 0, 0] } },
			shaftOffPlane: { id: 'c', shape: { kind: 'shaft', steps: [{ diameter: 8, length: 40 }] }, placement: { ...alongX, translate: [0, 10, 0] } },
			fastenerAlong: { id: 'd', shape: { kind: 'fastener', diameter: 6, length: 20 } },
			springAlong: { id: 'e', shape: { kind: 'spring', coilDiameter: 10, wireDiameter: 1.5, pitch: 3, length: 12 }, placement: alongX },
			shaftForced: { id: 'f', shape: { kind: 'shaft', steps: [{ diameter: 8, length: 40 }] }, placement: alongX, sectioned: true },
			boxDefault: { id: 'g', shape: { kind: 'box', size: [10, 10, 10] } },
			boxOptOut: { id: 'h', shape: { kind: 'box', size: [10, 10, 10] }, sectioned: false },
		};
		expect(Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, isSectioned(part, plane)]))).toEqual({
			shaftAlong: false,
			shaftAcross: true,
			shaftOffPlane: true,
			fastenerAlong: false,
			springAlong: false,
			shaftForced: true,
			boxDefault: true,
			boxOptOut: false,
		});
	});

	it('scene validator and port check: mark is "centre", axis is a port of axial parts', () => {
		const parts = [{ id: 'cam', name: 'cam', shape: { kind: 'extrudedPolygon' as const, points: [[10, 0], [0, 8], [-6, 0], [0, -8]] as const, height: 6 } }, { id: 'housing', shape: { kind: 'box' as const, size: [4, 4, 4] as const } }];
		const badMark = validateScene({ ...scene({}), numerals: [{ numeral: '10', part: 'housing', face: 'top', mark: 'cross' }] });
		expect({
			badMark: badMark.findings.map(finding => finding.message),
			axisOnCam: rules(checkSceneFaults(scene({ camera: 'top', parts, numerals: [{ numeral: '10', part: 'cam', face: 'axis' }, { numeral: '12', part: 'housing', face: 'top', mark: 'centre' }] }))),
			axisOnBox: rules(checkSceneFaults(scene({ parts, numerals: [{ numeral: '10', part: 'cam', face: 'top' }, { numeral: '12', part: 'housing', face: 'axis' }] }))),
		}).toEqual({
			badMark: ['numerals[0].mark: must be "centre"'],
			axisOnCam: [],
			axisOnBox: ['numeral-without-port'],
		});
	});
});
