/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene/drawingScene';
import { NumeralRequest, PartEdge, PlacedNumeral, placeNumerals } from '../numeralPlacer';
import { lineAngle, pointSegmentDistance, Rect, Segment } from '../planar';

/** A 40 mm square part "p" from (40, 40) to (80, 80), as its four visible edges. */
const CORNERS: readonly Vec2[] = [[40, 40], [80, 40], [80, 80], [40, 80]];
const EDGES: readonly PartEdge[] = CORNERS.map((corner, i) => ({ part: 'p', segment: [corner, CORNERS[(i + 1) % 4]] as Segment }));
const DRAWING: Rect = { x: 40, y: 40, width: 40, height: 40 };
const LEFT_EDGE: Segment = [[40, 80], [40, 40]];

function place(request: Partial<NumeralRequest> & { anchor: Vec2 }): PlacedNumeral {
	return placeNumerals([{ numeral: '10', part: 'p', surface: false, ...request }], EDGES.map(edge => edge.segment), DRAWING, EDGES)[0];
}

function onEdge(point: Vec2): boolean {
	return EDGES.some(edge => pointSegmentDistance(point, edge.segment) <= 0.3);
}

function inside(point: Vec2): boolean {
	return point[0] > 40 && point[0] < 80 && point[1] > 40 && point[1] < 80;
}

describe('Patent Drawings numeral placer: lead ends', () => {

	it('a face seen flat-on: the lead ends on the nearest edge and comes from outside (#693)', () => {
		const placed = place({ anchor: [60, 52] });
		expect({ endsOnEdge: onEdge(placed.lead![1]), startsOutside: !inside(placed.lead![0]) }).toEqual({ endsOnEdge: true, startsOutside: true });
	});

	it('a face seen edge-on: the lead meets the edge at 30 to 60 degrees (#694)', () => {
		const placed = place({ anchor: [40, 60], edgeOn: true });
		const angle = lineAngle(placed.lead!, LEFT_EDGE);
		expect({ endsOnEdge: onEdge(placed.lead![1]), inWindow: angle >= 30 && angle <= 60 }).toEqual({ endsOnEdge: true, inWindow: true });
	});

	it('a centre mark: the cross is at the anchor and the lead ends on the end of an arm (#693)', () => {
		const placed = place({ anchor: [60, 60], mark: true });
		const arms: Vec2[] = [[58.5, 60], [61.5, 60], [60, 58.5], [60, 61.5]];
		const end = placed.lead![1];
		expect({ centreMark: placed.centreMark, endsOnArmEnd: arms.some(arm => Math.hypot(arm[0] - end[0], arm[1] - end[1]) < 1e-9) }).toEqual({ centreMark: [60, 60], endsOnArmEnd: true });
	});
});
