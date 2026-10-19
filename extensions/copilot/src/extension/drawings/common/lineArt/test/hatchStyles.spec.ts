/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { checkFigureSvgFaults, figureHatchStyles } from '../../scene/drawingFaults';
import type { HatchOverride, Vec2 } from '../../scene/drawingScene';
import { layoutFigure, ProjectedPart, writeFigureSvg } from '../lineArt';

/** A sectioned rectangular part from (x0, y0) to (x1, y1), in model millimetres. */
function cutPart(id: string, x0: number, y0: number, x1: number, y1: number, hatch?: HatchOverride): ProjectedPart {
	const loop: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
	return { id, visible: [loop], hidden: [], cutFaces: [loop], hatch };
}

/** Lays out and writes the parts at 1:1, then reads back the hatch styles and the Findings. */
function render(parts: readonly ProjectedPart[]) {
	const layout = layoutFigure({ figure: 'FIG-1', parts, ports: [], hiddenEdges: 'omit', scale: 1 });
	const svg = writeFigureSvg(layout);
	return {
		layout: layout.hatchStyles,
		svg: figureHatchStyles(svg),
		findings: checkFigureSvgFaults(svg).map(finding => `${finding.severity} ${finding.rule}: ${finding.message}`),
	};
}

describe('Patent Drawings section hatching', () => {

	it('three touching sectioned parts take three different hatch styles and give no Note', () => {
		// a and b side by side; c under both. Each part touches the other two.
		expect(render([cutPart('a', 0, 0, 20, 20), cutPart('b', 20, 0, 40, 20), cutPart('c', 0, 20, 40, 32)])).toEqual({
			layout: [
				{ part: 'a', angle: 45, pitch: 2 },
				{ part: 'b', angle: 135, pitch: 2 },
				{ part: 'c', angle: 45, pitch: 1.5 },
			],
			svg: {
				a: { angle: 45, pitch: 2 },
				b: { angle: 135, pitch: 2 },
				c: { angle: 45, pitch: 1.5 },
			},
			findings: [],
		});
	});

	it('a part more than 0.5 mm away is not a neighbour and reuses the first style', () => {
		expect(render([cutPart('a', 0, 0, 20, 20), cutPart('b', 20, 0, 40, 20), cutPart('far', 41, 0, 60, 20)]).layout).toEqual([
			{ part: 'a', angle: 45, pitch: 2 },
			{ part: 'b', angle: 135, pitch: 2 },
			{ part: 'far', angle: 45, pitch: 2 },
		]);
	});

	it('an explicit hatch wins, the neighbours avoid it, and two touching overrides with one style give a Note', () => {
		expect(render([cutPart('a', 0, 0, 20, 20), cutPart('b', 20, 0, 40, 20, { angle: 45 }), cutPart('c', 40, 0, 60, 20, { angle: 45, pitch: 2 })])).toEqual({
			layout: [
				{ part: 'a', angle: 135, pitch: 2 },
				{ part: 'b', angle: 45, pitch: 2 },
				{ part: 'c', angle: 45, pitch: 2 },
			],
			svg: {
				a: { angle: 135, pitch: 2 },
				b: { angle: 45, pitch: 2 },
				c: { angle: 45, pitch: 2 },
			},
			findings: ['Note hatch-same-as-neighbour: Parts "b" and "c" touch and have the same hatch (45°, 2 mm); they read as one body.'],
		});
	});
});
