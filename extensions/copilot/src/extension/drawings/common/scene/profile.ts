/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ArcSegment, CamShape, ProfileItem, SplineSegment, Vec2 } from './drawingScene';

/*
 * The 2D profile math the kernel and the port anchors share. A spline segment is a chord-length
 * Catmull-Rom curve: it goes through each point, and its end tangents look at the neighbour
 * segments, so a spline that closes the profile has no corner at the start point. The kernel and
 * the anchors use the same curve, so a port on a curved side lies on the drawn line.
 */

/** One cubic Bezier piece of a spline segment. */
export interface BezierPiece {
	readonly from: Vec2;
	readonly c1: Vec2;
	readonly c2: Vec2;
	readonly to: Vec2;
}

/** One segment of a resolved profile, from the previous point to `to`. */
export type ProfileSegment =
	| { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2 }
	| { readonly kind: 'arc'; readonly from: Vec2; readonly through: Vec2; readonly to: Vec2 }
	| { readonly kind: 'spline'; readonly from: Vec2; readonly to: Vec2; readonly chain: readonly Vec2[]; readonly pieces: readonly BezierPiece[] };

/** True when the item is an arc segment. */
export function isArcItem(item: ProfileItem): item is ArcSegment {
	return !Array.isArray(item) && 'arc' in item;
}

/** True when the item is a spline segment. */
export function isSplineItem(item: ProfileItem): item is SplineSegment {
	return !Array.isArray(item) && 'spline' in item;
}

/** True when the profile has an arc or a spline segment. */
export function hasCurves(items: readonly ProfileItem[]): boolean {
	return items.some(item => !Array.isArray(item));
}

function samePoint(a: Vec2, b: Vec2): boolean {
	return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

/** Every point the profile names: plain points, arc ends and through points, spline points. */
export function profileVertices(items: readonly ProfileItem[]): Vec2[] {
	return items.flatMap((item): Vec2[] => isArcItem(item) ? [item.through, item.arc] : isSplineItem(item) ? [...item.spline] : [item as Vec2]);
}

type RawSegment =
	| { kind: 'line'; from: Vec2; to: Vec2 }
	| { kind: 'arc'; from: Vec2; through: Vec2; to: Vec2 }
	| { kind: 'spline'; from: Vec2; to: Vec2; chain: Vec2[] };

/**
 * Resolves a profile into its segments, the closing straight segment included unless the last
 * point is the first point. Segment i is side i + 1 (extrudedPolygon) or profile i + 1 (revolve).
 */
export function profileSegments(items: readonly ProfileItem[]): ProfileSegment[] {
	const start = items[0] as Vec2;
	let cursor = start;
	const raw: RawSegment[] = [];
	for (const item of items.slice(1)) {
		if (isArcItem(item)) {
			raw.push({ kind: 'arc', from: cursor, through: item.through, to: item.arc });
			cursor = item.arc;
		} else if (isSplineItem(item)) {
			const to = item.spline[item.spline.length - 1];
			raw.push({ kind: 'spline', from: cursor, to, chain: [cursor, ...item.spline] });
			cursor = to;
		} else {
			raw.push({ kind: 'line', from: cursor, to: item as Vec2 });
			cursor = item as Vec2;
		}
	}
	if (!samePoint(cursor, start)) {
		raw.push({ kind: 'line', from: cursor, to: start });
	}
	// The point before a segment end and the point after a segment start, as the tangents see them.
	const before = (segment: RawSegment) => segment.kind === 'line' ? segment.from : segment.kind === 'arc' ? segment.through : segment.chain[segment.chain.length - 2];
	const after = (segment: RawSegment) => segment.kind === 'line' ? segment.to : segment.kind === 'arc' ? segment.through : segment.chain[1];
	return raw.map((segment, index): ProfileSegment => {
		if (segment.kind !== 'spline') {
			return segment;
		}
		const previous = raw[(index - 1 + raw.length) % raw.length];
		const next = raw[(index + 1) % raw.length];
		return { ...segment, pieces: catmullRom([before(previous), ...segment.chain, after(next)]) };
	});
}

/** Chord-length Catmull-Rom pieces through `points[1]` … `points[n - 2]`; the outer points only set the end tangents. */
function catmullRom(points: readonly Vec2[]): BezierPiece[] {
	const distance = (a: Vec2, b: Vec2) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1e-9);
	const tangent = (k: number): Vec2 => {
		const span = distance(points[k - 1], points[k]) + distance(points[k], points[k + 1]);
		return [(points[k + 1][0] - points[k - 1][0]) / span, (points[k + 1][1] - points[k - 1][1]) / span];
	};
	const pieces: BezierPiece[] = [];
	for (let k = 1; k < points.length - 2; k++) {
		const from = points[k];
		const to = points[k + 1];
		const length = distance(from, to) / 3;
		const t1 = tangent(k);
		const t2 = tangent(k + 1);
		pieces.push({ from, c1: [from[0] + t1[0] * length, from[1] + t1[1] * length], c2: [to[0] - t2[0] * length, to[1] - t2[1] * length], to });
	}
	return pieces;
}

/** The point at parameter `t` (0 to 1) of a Bezier piece. */
export function bezierPoint(piece: BezierPiece, t: number): Vec2 {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return [a * piece.from[0] + b * piece.c1[0] + c * piece.c2[0] + d * piece.to[0], a * piece.from[1] + b * piece.c1[1] + c * piece.c2[1] + d * piece.to[1]];
}

/** The middle of a segment on the curve: a port on a side without a point anchors here. */
export function segmentMidpoint(segment: ProfileSegment): Vec2 {
	switch (segment.kind) {
		case 'line':
			return [(segment.from[0] + segment.to[0]) / 2, (segment.from[1] + segment.to[1]) / 2];
		case 'arc':
			return segment.through;
		case 'spline': {
			const count = segment.pieces.length;
			return count % 2 === 1 ? bezierPoint(segment.pieces[(count - 1) / 2], 0.5) : segment.chain[count / 2];
		}
	}
}

/** Points along a spline segment, `perPiece` per Bezier piece, from its start to its end. */
export function sampleSpline(segment: Extract<ProfileSegment, { kind: 'spline' }>, perPiece: number): Vec2[] {
	const points: Vec2[] = [segment.from];
	for (const piece of segment.pieces) {
		for (let s = 1; s <= perPiece; s++) {
			points.push(s === perPiece ? piece.to : bezierPoint(piece, s / perPiece));
		}
	}
	return points;
}

/** Angle grid step of the cam profile, in degrees. */
const CAM_STEP = 5;

/** The signed difference `a - b` in degrees, wrapped to (-180, 180]. */
function angleDifference(a: number, b: number): number {
	const difference = ((a - b) % 360 + 540) % 360 - 180;
	return difference === -180 ? 180 : difference;
}

/** The cam radius at an angle in degrees: the base circle plus a raised-cosine bump per lobe. */
export function camRadius(shape: CamShape, degrees: number): number {
	let radius = shape.base;
	for (const lobe of shape.lobes) {
		const offset = angleDifference(degrees, lobe.angle);
		if (Math.abs(offset) < lobe.width / 2) {
			radius += lobe.lift * (1 + Math.cos(2 * Math.PI * offset / lobe.width)) / 2;
		}
	}
	return radius;
}

/** The angles of the cam ports: the lobe centres and the middles of the lands, in lobe order. */
export function camPortAngles(shape: CamShape): { lobes: number[]; lands: number[] } {
	const lands = shape.lobes.map((lobe, index) => {
		const next = shape.lobes[(index + 1) % shape.lobes.length];
		const end = lobe.angle + lobe.width / 2;
		const gap = ((next.angle - next.width / 2 - end) % 360 + 360) % 360;
		return end + gap / 2;
	});
	return { lobes: shape.lobes.map(lobe => lobe.angle), lands };
}

/** The point of the cam outline at an angle in degrees. */
export function camPoint(shape: CamShape, degrees: number): Vec2 {
	const radius = camRadius(shape, degrees);
	const radians = degrees * Math.PI / 180;
	return [radius * Math.cos(radians), radius * Math.sin(radians)];
}

/**
 * The closed cam outline as one spline through points on a 5 degree grid, with extra points at
 * the lobe centres, lobe ends and land middles so the ports lie on the sampled points.
 */
export function camProfile(shape: CamShape): ProfileItem[] {
	const normal = (degrees: number) => (degrees % 360 + 360) % 360;
	const ports = camPortAngles(shape);
	const keys = [...ports.lobes, ...ports.lands, ...shape.lobes.flatMap(lobe => [lobe.angle - lobe.width / 2, lobe.angle + lobe.width / 2])].map(normal);
	const grid = Array.from({ length: 360 / CAM_STEP }, (_, index) => index * CAM_STEP).filter(angle => keys.every(key => Math.abs(angleDifference(angle, key)) > CAM_STEP / 4));
	const angles = [...keys, ...grid].sort((a, b) => a - b).filter((angle, index, all) => index === 0 || angle - all[index - 1] > 1e-6);
	const points = angles.map(angle => camPoint(shape, angle));
	return [points[0], { spline: [...points.slice(1), points[0]] }];
}
