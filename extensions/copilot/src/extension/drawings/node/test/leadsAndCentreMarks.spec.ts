/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { lineAngle, Segment } from '../../common/lineArt/planar';
import { checkFigureSvgFaults } from '../../common/scene/drawingFaults';
import type { DrawingScene, NumeralPort } from '../../common/scene/drawingScene';
import { renderFigure } from '../kernel/figureRenderer';

/**
 * FIG. 4 of the bicycle quick-release matter (2026-10-16): a 24-point cam (`extrudedPolygon`) and a
 * box, top camera. The `*-before.svg` files are what the engine wrote before #693 and #694: round 3
 * (154 and 194 on `top` faces) and round 1 (194 on the edge-on `left` face).
 */
function fixture(name: string): string {
	return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function findings(svg: string): string[] {
	return checkFigureSvgFaults(svg, { file: 'FIG-4.svg' }).map(finding => `${finding.rule}: ${finding.numeral}`);
}

/** The lead of a numeral in a written Figure SVG. */
function leadOf(svg: string, numeral: string): Segment {
	const match = new RegExp(`<line class="lead" data-numeral="${numeral}"[^>]*x1="(?<x1>[\\d.]+)" y1="(?<y1>[\\d.]+)" x2="(?<x2>[\\d.]+)" y2="(?<y2>[\\d.]+)"`).exec(svg)!;
	const value = (name: string) => Number(match.groups![name]);
	return [[value('x1'), value('y1')], [value('x2'), value('y2')]];
}

/** The four arm ends of the centre mark of a numeral (`M x1 y L x2 y M x y1 L x y2`). */
function armEnds(svg: string, numeral: string): [number, number][] {
	const d = new RegExp(`<path class="mark" data-numeral="${numeral}"[^>]* d="(?<d>[^"]*)"`).exec(svg)?.groups?.d ?? '';
	const values = d.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number);
	return [0, 2, 4, 6].map(i => [values[i], values[i + 1]]);
}

const KERNEL_TIMEOUT = 60_000;

describe('Lead ends and centre marks on the live FIG. 4 (#693, #694)', () => {

	it('the old placements give lead-ends-on-nothing and lead-along-edge', () => {
		expect({ round3: findings(fixture('fig4-round3-before.svg')), round1: findings(fixture('fig4-round1-before.svg')) }).toEqual({
			round3: ['lead-ends-on-nothing: 194', 'lead-ends-on-nothing: 154'],
			round1: ['lead-along-edge: 194', 'lead-ends-on-nothing: 154'],
		});
	});

	it('the live round-3 scene renders with every lead on an edge', async () => {
		const result = await renderFigure(JSON.parse(fixture('fig4-cam-profile.scene.json')));
		expect(result.findings.map(finding => finding.rule)).toEqual([]);
	}, KERNEL_TIMEOUT);

	it('154 on the cam axis gets a centre mark; 194 on the edge-on left face meets the edge at an angle', async () => {
		const scene: DrawingScene = JSON.parse(fixture('fig4-cam-profile.scene.json'));
		const numerals = scene.numerals.map((port): NumeralPort => port.numeral === '154' ? { numeral: '154', part: 'cam', face: 'axis' }
			: port.numeral === '194' ? { numeral: '194', part: 'camsurface', face: 'left', point: [0, 20, 3] } : port);
		const result = await renderFigure({ ...scene, numerals });
		const svg = result.svg ?? '';
		const lead194 = leadOf(svg, '194');
		const boxLeftEdge: Segment = [[lead194[1][0], 0], [lead194[1][0], 1]];
		const angle = lineAngle(lead194, boxLeftEdge);
		const lead154 = leadOf(svg, '154');
		expect({
			findings: result.findings.map(finding => finding.rule),
			centreMarks: svg.match(/<path class="mark"/g)?.length ?? 0,
			lead154EndsOnArmEnd: armEnds(svg, '154').some(end => Math.hypot(end[0] - lead154[1][0], end[1] - lead154[1][1]) < 0.02),
			lead194At30To60Degrees: angle >= 30 && angle <= 60,
		}).toEqual({ findings: [], centreMarks: 1, lead154EndsOnArmEnd: true, lead194At30To60Degrees: true });
	}, KERNEL_TIMEOUT);
});
