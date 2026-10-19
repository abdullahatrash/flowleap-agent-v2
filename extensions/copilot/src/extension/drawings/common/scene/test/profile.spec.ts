/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { CamShape, ProfileItem, ScenePart } from '../drawingScene';
import { camProfile, profileSegments, segmentMidpoint } from '../profile';
import { cameraBasis, faceNames, resolvePort } from '../sceneGeometry';
import { validateScene } from '../sceneValidator';

const round = (value: number) => Math.round(value * 1000) / 1000;

const CAM: CamShape = { kind: 'cam', base: 6, lobes: [{ angle: 0, lift: 4, width: 100 }, { angle: 120, lift: 4, width: 100 }, { angle: 240, lift: 4, width: 100 }], height: 6 };

function messages(points: readonly unknown[]): string[] {
	const result = validateScene({ figure: 'FIG-1', camera: 'top', parts: [{ id: 'p', shape: { kind: 'extrudedPolygon', points, height: 2 } }], numerals: [] });
	return result.findings.map(finding => finding.message);
}

describe('Patent Drawings engine: smooth profiles and the cam part', () => {

	it('an arc or a spline is one side, anchored on the curve', () => {
		const items: ProfileItem[] = [[0, 0], [20, 0], { arc: [20, 20], through: [30, 10] }, { spline: [[10, 25], [0, 20]] }];
		const segments = profileSegments(items);
		expect({
			kinds: segments.map(segment => segment.kind),
			middles: segments.map(segment => segmentMidpoint(segment).map(round)),
			names: faceNames({ kind: 'extrudedPolygon', points: items, height: 2 }),
		}).toEqual({
			kinds: ['line', 'arc', 'spline', 'line'],
			middles: [[10, 0], [30, 10], [10, 25], [0, 10]],
			names: ['top', 'bottom', 'side-1', 'side-2', 'side-3', 'side-4', 'axis'],
		});
	});

	it('a spline that closes the profile has no closing line and no corner at the start', () => {
		const segments = profileSegments(camProfile(CAM));
		const spline = segments[0];
		const start = spline.kind === 'spline' ? spline.pieces[0] : undefined;
		const end = spline.kind === 'spline' ? spline.pieces[spline.pieces.length - 1] : undefined;
		const direction = (from: readonly number[], to: readonly number[]) => Math.atan2(to[1] - from[1], to[0] - from[0]);
		expect({
			kinds: segments.map(segment => segment.kind),
			tangentMismatch: start && end ? round(Math.abs(direction(start.from, start.c1) - direction(end.c2, end.to))) : undefined,
		}).toEqual({ kinds: ['spline'], tangentMismatch: 0 });
	});

	it('a cam part exposes its named faces at the lobe tips, the lands and the axis', () => {
		const part: ScenePart = { id: 'cam', shape: CAM };
		const names = faceNames(CAM) ?? [];
		const anchors = Object.fromEntries(names.map(face => [face, resolvePort({ numeral: '1', part: 'cam', face }, part, cameraBasis('top'))?.map(round)]));
		expect(anchors).toEqual({
			top: [0, 0, 6],
			bottom: [0, 0, 0],
			axis: [0, 0, 6],
			'lobe-1': [10, 0, 3],
			'lobe-2': [-5, 8.66, 3],
			'lobe-3': [-5, -8.66, 3],
			'land-1': [3, 5.196, 3],
			'land-2': [-6, 0, 3],
			'land-3': [3, -5.196, 3],
		});
	});

	it('the validator checks the segment forms', () => {
		expect({
			good: messages([[0, 0], [20, 0], { arc: [20, 20], through: [30, 10] }, { spline: [[10, 25], [0, 20]] }]),
			startsWithCurve: messages([{ arc: [20, 20], through: [30, 10] }, [0, 0], [20, 0]]),
			collinearArc: messages([[0, 0], [20, 0], { arc: [40, 0], through: [30, 0] }]),
			repeatedArcPoint: messages([[0, 0], [20, 0], { arc: [20, 0], through: [30, 10] }]),
			shortSpline: messages([[0, 0], [20, 0], { spline: [[0, 10]] }]),
			unknownItem: messages([[0, 0], [20, 0], { bezier: [0, 10] }]),
			badCam: validateScene({ figure: 'FIG-1', camera: 'top', parts: [{ id: 'c', shape: { kind: 'cam', base: 5, lobes: [{ angle: 0, lift: 0, width: 400 }], height: 2 } }], numerals: [] }).findings.map(finding => finding.message),
			codeKind: validateScene({ figure: 'FIG-1', camera: 'top', parts: [{ id: 'c', shape: { kind: 'code', code: 'return replicad.makeBox([0, 0, 0], [1, 1, 1]);' } }], numerals: [] }).findings.map(finding => `${finding.rule}: ${finding.message}`),
		}).toEqual({
			good: [],
			startsWithCurve: ['parts[0].shape.points[0]: must be a plain point [x, y]: a profile starts with a point'],
			collinearArc: ['parts[0].shape.points[2]: an arc needs three distinct points that are not on one line (previous point, "through", "arc")'],
			repeatedArcPoint: ['parts[0].shape.points[2]: an arc needs three distinct points that are not on one line (previous point, "through", "arc")'],
			shortSpline: ['parts[0].shape.points[2].spline: must be an array of at least 2 points'],
			unknownItem: ['parts[0].shape.points[2]: must be a point [x, y], an arc { "arc": [x, y], "through": [x, y] } or a spline { "spline": [[x, y], ...] }'],
			badCam: ['parts[0].shape.lobes[0].lift: must be a positive number', 'parts[0].shape.lobes[0].width: must be a number of degrees in (0, 360]'],
			codeKind: ['scene-schema: parts[0].shape.kind: the "code" kind was dropped (#799, 2026-10-19): build the part from primitives or a library part'],
		});
	});
});
