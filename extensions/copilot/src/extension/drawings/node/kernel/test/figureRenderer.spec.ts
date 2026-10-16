/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { flattenSvgPath } from '../../../common/lineArt/planar';
import { figureHatchStyles } from '../../../common/scene/drawingFaults';
import type { DrawingScene, Vec2 } from '../../../common/scene/drawingScene';
import { renderFigure } from '../figureRenderer';

function fixture(name: string): DrawingScene {
	return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.scene.json`), 'utf8'));
}

function rules(findings: readonly { rule: string }[]): string[] {
	return findings.map(finding => finding.rule);
}

/**
 * The points of a part's visible edges where the line turns by more than `degrees` between two
 * adjacent straight pieces, in model millimetres for a scene drawn at `scale: 1` (the sheet
 * margin is 24 mm and the sheet y axis points down). A closed path is checked across its start too.
 */
function corners(svg: string, part: string, degrees = 10): Vec2[] {
	const height = Number(/viewBox="0 0 (?<width>[\d.]+) (?<height>[\d.]+)"/.exec(svg)!.groups!.height) - 48;
	const result: Vec2[] = [];
	for (const match of svg.matchAll(new RegExp(`class="edge" data-part="${part}"[^>]* d="(?<d>[^"]+)"`, 'g'))) {
		for (const line of flattenSvgPath(match.groups!.d)) {
			const closed = line.length > 2 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
			const points = closed ? [line[line.length - 2], ...line] : line;
			for (let k = 1; k < points.length - 1; k++) {
				const [a, b, c] = [points[k - 1], points[k], points[k + 1]];
				const turn = Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])));
				if (turn > degrees * Math.PI / 180) {
					result.push([Math.round(b[0] - 24), Math.round(height - (b[1] - 24))]);
				}
			}
		}
	}
	return result.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/** The drawing size of a scene drawn at `scale: 1`, in model millimetres. */
function span(svg: string): Vec2 {
	const groups = /viewBox="0 0 (?<width>[\d.]+) (?<height>[\d.]+)"/.exec(svg)!.groups!;
	return [Math.round((Number(groups.width) - 48) * 10) / 10, Math.round((Number(groups.height) - 48) * 10) / 10];
}

// The kernel loads once per file (about 0.6 s); the spring's helix sweep takes several seconds of hidden-line removal.
const KERNEL_TIMEOUT = 60_000;

describe('Patent Drawings engine: scene to FIG-N.svg', () => {

	for (const name of ['box-two-numerals', 'revolve-section', 'assembly-three-parts', 'cam-polygon-before', 'cam-three-lobes']) {
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

	it('a shaft along the section plane stays unhatched; the body around it is hatched', async () => {
		const result = await renderFigure(fixture('shaft-through-body'));
		await expect(`<!-- findings: ${JSON.stringify(rules(result.findings))} hatch: ${JSON.stringify(figureHatchStyles(result.svg ?? ''))} -->\n${result.svg}`).toMatchFileSnapshot('fixtures/shaft-through-body.svg');
	}, KERNEL_TIMEOUT);

	it('the live quick-release section: the skewer and spring stay clear, touching parts take different hatches', async () => {
		const result = await renderFigure(fixture('quick-release-section'));
		expect({ findings: rules(result.findings), hatch: figureHatchStyles(result.svg ?? '') }).toMatchInlineSnapshot(`
			{
			  "findings": [],
			  "hatch": {
			    "head1": {
			      "angle": 45,
			      "pitch": 2,
			    },
			    "head2": {
			      "angle": 45,
			      "pitch": 2,
			    },
			    "lever": {
			      "angle": 135,
			      "pitch": 2,
			    },
			    "shuttle": {
			      "angle": 135,
			      "pitch": 2,
			    },
			  },
			}
		`);
	}, 4 * KERNEL_TIMEOUT);

	it('a port point off its part gives lead-line-off-part', async () => {
		const scene = fixture('box-two-numerals');
		const result = await renderFigure({ ...scene, numerals: [{ numeral: '10', part: 'housing', face: 'front', point: [200, -50, 10] }] });
		expect(rules(result.findings)).toEqual(['lead-line-off-part']);
	}, KERNEL_TIMEOUT);

	it('an arc segment and a spline segment round-trip through the kernel as smooth sides', async () => {
		const plate = await renderFigure({
			figure: 'FIG-1', camera: 'top', scale: 1,
			parts: [{ id: 'plate', shape: { kind: 'extrudedPolygon', points: [[0, 0], [20, 0], { arc: [20, 20], through: [30, 10] }, { spline: [[10, 25], [0, 20]] }], height: 2 } }],
			numerals: [{ numeral: '10', part: 'plate', face: 'side-2' }, { numeral: '12', part: 'plate', face: 'side-3' }],
		});
		const knob = await renderFigure({
			figure: 'FIG-2', camera: 'front', scale: 1,
			parts: [{ id: 'knob', shape: { kind: 'revolve', profile: [[0, 0], [8, 0], [8, 10], { arc: [0, 18], through: [5.657, 15.657] }] } }],
			numerals: [{ numeral: '20', part: 'knob', face: 'profile-3' }],
		});
		expect({
			plate: { findings: rules(plate.findings), span: span(plate.svg!), corners: corners(plate.svg!, 'plate') },
			knob: { findings: rules(knob.findings), span: span(knob.svg!), corners: corners(knob.svg!, 'knob') },
		}).toEqual({
			// The only corners are where a straight side meets a curve at an angle: (0, 0), the spline ends.
			plate: { findings: [], span: [30, 25], corners: [[0, 0], [0, 20], [20, 20]] },
			// The dome meets the cylinder tangentially; only a base corner turns (the other base corner is where two paths meet).
			knob: { findings: [], span: [16, 18], corners: [[16, 0]] },
		});
	}, KERNEL_TIMEOUT);

	it('the live FIG. 4 cam is faceted as a polygon and smooth as a cam part', async () => {
		const before = await renderFigure(fixture('cam-polygon-before'));
		const after = await renderFigure(fixture('cam-three-lobes'));
		const scaled = (scene: DrawingScene) => ({ ...scene, scale: 1, numerals: [] });
		expect({
			before: { findings: rules(before.findings), corners: corners((await renderFigure(scaled(fixture('cam-polygon-before')))).svg!, 'cam').length },
			after: { findings: rules(after.findings), corners: corners((await renderFigure(scaled(fixture('cam-three-lobes')))).svg!, 'cam') },
		}).toEqual({
			// 24 of the 36 polygon points turn by more than 10 degrees: the facets of the live render.
			before: { findings: [], corners: 24 },
			after: { findings: [], corners: [] },
		});
	}, KERNEL_TIMEOUT);

	it('a numeral on the axis of a cam draws one centre mark', async () => {
		const scene = fixture('cam-three-lobes');
		const result = await renderFigure({ ...scene, parts: [scene.parts[0]], numerals: [{ numeral: '154', part: 'cam', face: 'axis' }] });
		expect({ findings: rules(result.findings), marks: (result.svg ?? '').match(/class="mark"/g)?.length ?? 0 }).toEqual({ findings: [], marks: 1 });
	}, KERNEL_TIMEOUT);
});
