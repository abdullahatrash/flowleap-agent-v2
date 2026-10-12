/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Vec2 } from './drawingScene';

/** A straight segment in drawing coordinates. */
export type Segment = readonly [Vec2, Vec2];

/** An axis-aligned rectangle in drawing coordinates (y down). */
export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

const EPSILON = 1e-9;

function cross(o: Vec2, a: Vec2, b: Vec2): number {
	return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** True when the two segments cross or touch, shared end points excluded. */
export function segmentsIntersect(a: Segment, b: Segment): boolean {
	const shared = (p: Vec2, q: Vec2) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
	if (shared(a[0], b[0]) || shared(a[0], b[1]) || shared(a[1], b[0]) || shared(a[1], b[1])) {
		return false;
	}
	const d1 = cross(b[0], b[1], a[0]);
	const d2 = cross(b[0], b[1], a[1]);
	const d3 = cross(a[0], a[1], b[0]);
	const d4 = cross(a[0], a[1], b[1]);
	if (((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) && ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))) {
		return true;
	}
	const onSegment = (p: Vec2, q: Vec2, r: Vec2) => Math.min(p[0], q[0]) - EPSILON <= r[0] && r[0] <= Math.max(p[0], q[0]) + EPSILON && Math.min(p[1], q[1]) - EPSILON <= r[1] && r[1] <= Math.max(p[1], q[1]) + EPSILON;
	return (Math.abs(d1) <= EPSILON && onSegment(b[0], b[1], a[0]))
		|| (Math.abs(d2) <= EPSILON && onSegment(b[0], b[1], a[1]))
		|| (Math.abs(d3) <= EPSILON && onSegment(a[0], a[1], b[0]))
		|| (Math.abs(d4) <= EPSILON && onSegment(a[0], a[1], b[1]));
}

/** True when the rectangles overlap by more than touching. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Grows a rectangle by `margin` on every side. */
export function inflate(rect: Rect, margin: number): Rect {
	return { x: rect.x - margin, y: rect.y - margin, width: rect.width + 2 * margin, height: rect.height + 2 * margin };
}

function pointInRect(point: Vec2, rect: Rect): boolean {
	return point[0] > rect.x && point[0] < rect.x + rect.width && point[1] > rect.y && point[1] < rect.y + rect.height;
}

/** True when the segment passes through the inside of the rectangle. */
export function segmentHitsRect(segment: Segment, rect: Rect): boolean {
	if (pointInRect(segment[0], rect) || pointInRect(segment[1], rect)) {
		return true;
	}
	const { x, y, width, height } = rect;
	const corners: Vec2[] = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
	return corners.some((corner, i) => segmentsIntersect(segment, [corner, corners[(i + 1) % 4]]));
}

/** The distance from a point to a segment. */
export function pointSegmentDistance(point: Vec2, segment: Segment): number {
	const [a, b] = segment;
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared < EPSILON ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
	return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

/** The distance from a point to the nearest point of a rectangle (0 inside). */
export function pointRectDistance(point: Vec2, rect: Rect): number {
	const dx = Math.max(rect.x - point[0], 0, point[0] - (rect.x + rect.width));
	const dy = Math.max(rect.y - point[1], 0, point[1] - (rect.y + rect.height));
	return Math.hypot(dx, dy);
}

/** The convex hull of the points, counter-clockwise in y-up terms (monotone chain). */
export function convexHull(points: readonly Vec2[]): Vec2[] {
	const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (sorted.length < 3) {
		return sorted;
	}
	const half = (input: Vec2[]) => {
		const result: Vec2[] = [];
		for (const point of input) {
			while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) {
				result.pop();
			}
			result.push(point);
		}
		result.pop();
		return result;
	};
	return [...half(sorted), ...half([...sorted].reverse())];
}

/** The distance from a point to a convex polygon; 0 when the point is inside or on it. */
export function pointPolygonDistance(point: Vec2, polygon: readonly Vec2[]): number {
	if (polygon.length === 0) {
		return Infinity;
	}
	if (polygon.length >= 3) {
		let inside = false;
		for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
			const [xi, yi] = polygon[i];
			const [xj, yj] = polygon[j];
			if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) {
				inside = !inside;
			}
		}
		if (inside) {
			return 0;
		}
	}
	let best = Infinity;
	for (let i = 0; i < polygon.length; i++) {
		best = Math.min(best, pointSegmentDistance(point, [polygon[i], polygon[(i + 1) % polygon.length]]));
	}
	return best;
}

/** Splits polylines into their segments. */
export function toSegments(polylines: readonly (readonly Vec2[])[]): Segment[] {
	const segments: Segment[] = [];
	for (const line of polylines) {
		for (let i = 0; i + 1 < line.length; i++) {
			segments.push([line[i], line[i + 1]]);
		}
	}
	return segments;
}

/**
 * Hatching lines inside a region, clipped in code. The region is the set of boundary segments
 * (closed loops, any order; a hole is a loop inside a loop: even-odd rule). Lines run at `degrees`
 * from the x axis, measured counter-clockwise on the sheet (y up), `spacing` apart.
 */
export function hatch(boundary: readonly Segment[], degrees: number, spacing: number): Segment[] {
	if (boundary.length === 0) {
		return [];
	}
	const radians = degrees * Math.PI / 180;
	// Direction along the hatch line on the sheet (y down in drawing coordinates).
	const along: Vec2 = [Math.cos(radians), -Math.sin(radians)];
	const across: Vec2 = [-along[1], along[0]];
	const offsetOf = (point: Vec2) => point[0] * across[0] + point[1] * across[1];
	const positionOf = (point: Vec2) => point[0] * along[0] + point[1] * along[1];
	const offsets = boundary.flatMap(segment => [offsetOf(segment[0]), offsetOf(segment[1])]);
	const low = Math.min(...offsets);
	const high = Math.max(...offsets);
	const lines: Segment[] = [];
	for (let offset = Math.ceil(low / spacing) * spacing; offset <= high; offset += spacing) {
		const hits: number[] = [];
		for (const [a, b] of boundary) {
			const oa = offsetOf(a);
			const ob = offsetOf(b);
			// Half-open rule so a vertex on the line counts once.
			if ((oa <= offset) === (ob <= offset)) {
				continue;
			}
			const t = (offset - oa) / (ob - oa);
			hits.push(positionOf(a) + t * (positionOf(b) - positionOf(a)));
		}
		hits.sort((a, b) => a - b);
		for (let i = 0; i + 1 < hits.length; i += 2) {
			const point = (position: number): Vec2 => [along[0] * position + across[0] * offset, along[1] * position + across[1] * offset];
			if (hits[i + 1] - hits[i] > 1e-6) {
				lines.push([point(hits[i]), point(hits[i + 1])]);
			}
		}
	}
	return lines;
}

/**
 * Flattens SVG path data into polylines. Supports the absolute commands the kernel writes
 * (M, L, H, V, A, C, Q, Z). Curves become `steps` straight pieces.
 */
export function flattenSvgPath(d: string, steps = 16): Vec2[][] {
	const tokens = d.match(/[MLHVACQZmlhvacqz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
	const polylines: Vec2[][] = [];
	let current: Vec2[] = [];
	let cursor: Vec2 = [0, 0];
	let start: Vec2 = [0, 0];
	let command = '';
	let i = 0;
	const next = () => Number(tokens[i++]);
	while (i < tokens.length) {
		if (/[A-Za-z]/.test(tokens[i])) {
			command = tokens[i++].toUpperCase();
		}
		switch (command) {
			case 'M':
				if (current.length > 1) {
					polylines.push(current);
				}
				cursor = [next(), next()];
				start = cursor;
				current = [cursor];
				command = 'L';
				break;
			case 'L':
				cursor = [next(), next()];
				current.push(cursor);
				break;
			case 'H':
				cursor = [next(), cursor[1]];
				current.push(cursor);
				break;
			case 'V':
				cursor = [cursor[0], next()];
				current.push(cursor);
				break;
			case 'C': {
				const c1: Vec2 = [next(), next()];
				const c2: Vec2 = [next(), next()];
				const end: Vec2 = [next(), next()];
				const from = cursor;
				for (let s = 1; s <= steps; s++) {
					const t = s / steps;
					const u = 1 - t;
					current.push([
						u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
						u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
					]);
				}
				cursor = end;
				break;
			}
			case 'Q': {
				const control: Vec2 = [next(), next()];
				const end: Vec2 = [next(), next()];
				const from = cursor;
				for (let s = 1; s <= steps; s++) {
					const t = s / steps;
					const u = 1 - t;
					current.push([u * u * from[0] + 2 * u * t * control[0] + t * t * end[0], u * u * from[1] + 2 * u * t * control[1] + t * t * end[1]]);
				}
				cursor = end;
				break;
			}
			case 'A': {
				const rx = next();
				const ry = next();
				const rotation = next();
				const largeArc = next();
				const sweep = next();
				const end: Vec2 = [next(), next()];
				current.push(...arcPoints(cursor, end, rx, ry, rotation, largeArc !== 0, sweep !== 0, steps));
				cursor = end;
				break;
			}
			case 'Z':
				current.push(start);
				cursor = start;
				polylines.push(current);
				current = [start];
				command = '';
				break;
			default:
				// Unknown token: skip it so a malformed path cannot loop forever.
				i++;
		}
	}
	if (current.length > 1) {
		polylines.push(current);
	}
	return polylines;
}

/** Points along an SVG elliptical arc (endpoint parameterisation, SVG 1.1 appendix F.6). */
function arcPoints(from: Vec2, to: Vec2, rxIn: number, ryIn: number, rotationDegrees: number, largeArc: boolean, sweep: boolean, steps: number): Vec2[] {
	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	if (rx < EPSILON || ry < EPSILON) {
		return [to];
	}
	const phi = rotationDegrees * Math.PI / 180;
	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);
	const dx = (from[0] - to[0]) / 2;
	const dy = (from[1] - to[1]) / 2;
	const x1 = cosPhi * dx + sinPhi * dy;
	const y1 = -sinPhi * dx + cosPhi * dy;
	const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}
	const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
	const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
	const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
	const cx1 = factor * rx * y1 / ry;
	const cy1 = -factor * ry * x1 / rx;
	const cx = cosPhi * cx1 - sinPhi * cy1 + (from[0] + to[0]) / 2;
	const cy = sinPhi * cx1 + cosPhi * cy1 + (from[1] + to[1]) / 2;
	const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
	let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
	if (!sweep && delta > 0) {
		delta -= 2 * Math.PI;
	} else if (sweep && delta < 0) {
		delta += 2 * Math.PI;
	}
	const count = Math.max(2, Math.ceil(steps * Math.abs(delta) / Math.PI));
	const points: Vec2[] = [];
	for (let s = 1; s <= count; s++) {
		const t = theta + delta * s / count;
		const x = rx * Math.cos(t);
		const y = ry * Math.sin(t);
		points.push(s === count ? to : [cosPhi * x - sinPhi * y + cx, sinPhi * x + cosPhi * y + cy]);
	}
	return points;
}
