/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Vec2 } from '../scene/drawingScene';
import { convexHull, inflate, lineAngle, nearestPointOnSegment, parallelOverlap, pointPolygonDistance, pointSegmentDistance, Rect, rectsOverlap, Segment, segmentHitsRect, segmentsIntersect } from './planar';

/**
 * Numeral font size in sheet millimetres. Digit height in Liberation Sans and Arial is 0.716 of the
 * font size, so 4.5 mm gives 3.22 mm digits: over the 3.2 mm minimum of 37 CFR 1.84(p)(3),
 * OJ EPO 2025 A49 Art. 1(2)(g) and PCT Rule 11.13(h). The rules set a character height, not a font
 * size: a 3.2 mm font size gives only 2.29 mm digits and does not file. A sheet that scales a
 * Figure must keep font size x 0.716 x scale >= 3.2 mm. Decision accepted for PRD 0023 slice D1 (#645).
 */
export const NUMERAL_FONT_SIZE = 4.5;

/** Digit (and capital) height as a fraction of the font size, Liberation Sans and Arial metrics. */
export const DIGIT_HEIGHT_RATIO = 0.716;

/** Mean digit advance as a fraction of the font size (every digit is 0.556 em in Arial). */
export const DIGIT_WIDTH_RATIO = 0.556;

/** Gap in millimetres between a numeral and the start of its lead line. */
export const LEAD_GAP = 0.8;

/**
 * A lead line ends on a visible edge or on a centre mark: its end is within this distance of one,
 * in millimetres (37 CFR 1.84(q), "extend to the feature indicated").
 */
export const LEAD_END_TOLERANCE = 0.3;
/** Half the length of each arm of a centre mark, in millimetres: each arm is 3 mm long. */
export const CENTRE_MARK_ARM = 1.5;
/** A lead line runs along an edge when the lines differ by less than this angle, in degrees... */
export const ALONG_EDGE_ANGLE = 5;
/** ...and the lead stays within `LEAD_END_TOLERANCE` of the edge for more than this length, in millimetres. */
export const ALONG_EDGE_LENGTH = 1;
/** The angle window, in degrees from the edge or arm, in which a lead line meets a face seen edge-on or a centre mark arm. */
const APPROACH_ANGLES: Vec2 = [30, 60];
/** The angle window, in degrees from the edge, in which a lead line comes onto the edge of a face seen flat-on. */
const FLAT_ON_ANGLES: Vec2 = [30, 90];

/** The two crossing lines of a centre mark at `centre`: one along the view's horizontal, one vertical. */
export function centreMarkLines(centre: Vec2): readonly Segment[] {
	const [x, y] = centre;
	return [[[x - CENTRE_MARK_ARM, y], [x + CENTRE_MARK_ARM, y]], [[x, y - CENTRE_MARK_ARM], [x, y + CENTRE_MARK_ARM]]];
}

/** True when a lead line runs along the edge: same direction within 5 degrees and close to it for more than 1 mm. */
export function leadRunsAlong(lead: Segment, edge: Segment): boolean {
	return parallelOverlap(lead, edge, ALONG_EDGE_ANGLE, LEAD_END_TOLERANCE) > ALONG_EDGE_LENGTH;
}

/** The box a numeral glyph run covers, for text centred on `x` with its baseline at `y`. */
export function numeralBox(text: string, x: number, y: number, fontSize: number): Rect {
	const width = text.length * DIGIT_WIDTH_RATIO * fontSize;
	const height = DIGIT_HEIGHT_RATIO * fontSize;
	return { x: x - width / 2, y: y - height, width, height };
}

/** A numeral to place: the projected port point is its anchor. */
export interface NumeralRequest {
	readonly numeral: string;
	readonly part: string;
	readonly anchor: Vec2;
	readonly surface: boolean;
	/** True when the numeral gets a centre mark at its anchor and the lead ends on one arm. */
	readonly mark?: boolean;
	/** True when the anchor's face is a plane seen edge-on: the lead meets that edge at 30 to 60 degrees. */
	readonly edgeOn?: boolean;
}

/** A visible edge segment of one part, in sheet millimetres. */
export interface PartEdge {
	readonly part: string;
	readonly segment: Segment;
}

/** A placed numeral: text centred on `x` with its baseline at `y`, and its lead line. */
export interface PlacedNumeral {
	readonly numeral: string;
	readonly part: string;
	readonly x: number;
	readonly y: number;
	readonly box: Rect;
	readonly surface: boolean;
	/** From beside the numeral to a visible edge or a centre mark arm. Absent for a surface numeral. */
	readonly lead?: Segment;
	/** The centre of the centre mark, when the numeral has one. */
	readonly centreMark?: Vec2;
}

/** Distances in millimetres from the drawing to the rings of candidate positions. */
const RING_GAPS = [7, 11, 15];
/** Candidate spacing along a ring, in millimetres. */
const RING_STEP = 1.5;
/** Clear space kept around a numeral. */
const CLEARANCE = 1;

function ringCandidates(drawing: Rect): Vec2[] {
	const candidates: Vec2[] = [];
	for (const gap of RING_GAPS) {
		const ring = inflate(drawing, gap);
		const corners: Vec2[] = [[ring.x, ring.y], [ring.x + ring.width, ring.y], [ring.x + ring.width, ring.y + ring.height], [ring.x, ring.y + ring.height]];
		for (let side = 0; side < 4; side++) {
			const from = corners[side];
			const to = corners[(side + 1) % 4];
			const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
			const count = Math.max(1, Math.floor(length / RING_STEP));
			for (let i = 0; i < count; i++) {
				const t = i / count;
				candidates.push([from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]);
			}
		}
	}
	return candidates;
}

/** The point where the ray from the box centre towards `target` leaves the box grown by the lead gap. */
function leadStart(box: Rect, target: Vec2): Vec2 {
	const grown = inflate(box, LEAD_GAP);
	const centre: Vec2 = [box.x + box.width / 2, box.y + box.height / 2];
	const dx = target[0] - centre[0];
	const dy = target[1] - centre[1];
	const tx = Math.abs(dx) < 1e-9 ? Infinity : (grown.width / 2) / Math.abs(dx);
	const ty = Math.abs(dy) < 1e-9 ? Infinity : (grown.height / 2) / Math.abs(dy);
	const t = Math.min(tx, ty, 1);
	return [centre[0] + dx * t, centre[1] + dy * t];
}

/** Where a lead line ends, and what the approach should look like. */
interface LeadTarget {
	readonly end: Vec2;
	/** The centre mark arms, each from the centre out; the lead ends on the end of one arm. */
	readonly arms?: readonly Segment[];
	/** The edge (or the arm) the lead ends on. */
	readonly edge?: Segment;
	/** The angle window to the edge, in degrees, for a face seen edge-on or a centre mark arm. */
	readonly window?: Vec2;
	/** The anchor inside a face seen flat-on: the lead comes from the other side of the edge. */
	readonly inside?: Vec2;
}

/**
 * The lead end of a numeral. A centre mark: the end of an arm. An anchor on a visible edge of its
 * part: that edge. An anchor inside the part, away from every edge (a face seen flat-on): the
 * nearest point of the part's visible edges, approached from outside. Else the anchor itself.
 */
function leadTarget(request: NumeralRequest, partEdges: readonly Segment[], hull: readonly Vec2[]): LeadTarget {
	const anchor = request.anchor;
	if (request.mark) {
		const arms = centreMarkLines(anchor).flatMap(([from, to]): Segment[] => [[anchor, from], [anchor, to]]);
		return { end: arms[0][1], arms, window: APPROACH_ANGLES };
	}
	let edge: Segment | undefined;
	let distance = Infinity;
	for (const segment of partEdges) {
		const next = pointSegmentDistance(anchor, segment);
		if (next < distance) {
			distance = next;
			edge = segment;
		}
	}
	if (!edge) {
		return { end: anchor };
	}
	const end = nearestPointOnSegment(anchor, edge);
	if (distance <= LEAD_END_TOLERANCE) {
		return { end, edge, window: request.edgeOn ? APPROACH_ANGLES : undefined };
	}
	return pointPolygonDistance(anchor, hull) === 0 ? { end, edge, window: FLAT_ON_ANGLES, inside: anchor } : { end: anchor };
}

/** The arm a lead from `from` ends on: the nearest arm it meets in the window, else the nearest arm. */
function armTarget(target: LeadTarget, from: Vec2): LeadTarget {
	const arms = [...target.arms!].sort((a, b) => Math.hypot(a[1][0] - from[0], a[1][1] - from[1]) - Math.hypot(b[1][0] - from[0], b[1][1] - from[1]));
	const inWindow = (arm: Segment) => {
		const angle = lineAngle([from, arm[1]], arm);
		return angle >= APPROACH_ANGLES[0] && angle <= APPROACH_ANGLES[1];
	};
	const arm = arms.find(inWindow) ?? arms[0];
	return { ...target, end: arm[1], edge: arm };
}

/** The side of the line through `segment` that `point` lies on: 1, -1, or 0 on the line. */
function side(segment: Segment, point: Vec2): number {
	const [a, b] = segment;
	return Math.sign((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]));
}

/** True when the lead meets its target the preferred way: in the angle window, or from outside the face. */
function approachPreferred(lead: Segment, target: LeadTarget): boolean {
	if (target.edge && target.window) {
		const angle = lineAngle(lead, target.edge);
		if (angle < target.window[0] || angle > target.window[1]) {
			return false;
		}
	}
	return !(target.edge && target.inside) || side(target.edge, lead[0]) * side(target.edge, target.inside) < 0;
}

/**
 * Places numerals on rings of candidate positions around the drawing. Deterministic: numerals are
 * taken in angular order around the drawing centre, candidates by distance to the anchor. A lead
 * line ends on a visible edge of its part or on a centre mark arm (see `leadTarget`), never on an
 * empty face. The first candidate is kept whose numeral clears the drawing, the centre marks and
 * the other numerals, whose lead line crosses no other lead line or numeral, runs along no visible
 * edge, and meets its target the preferred way (30 to 60 degrees to an edge seen edge-on or to a
 * centre mark arm; from outside a face seen flat-on, at 30 degrees or more to its edge). Without such a candidate, the first that only fails the preferred
 * approach is kept, then the first clear one, then the nearest; the mechanical fault list reports
 * what is left.
 */
export function placeNumerals(requests: readonly NumeralRequest[], obstacles: readonly Segment[], drawing: Rect, edges: readonly PartEdge[] = [], fontSize = NUMERAL_FONT_SIZE): PlacedNumeral[] {
	const placed: PlacedNumeral[] = [];
	const glyphOffset = DIGIT_HEIGHT_RATIO * fontSize / 2;
	for (const request of requests.filter(item => item.surface)) {
		const x = request.anchor[0];
		const y = request.anchor[1] + glyphOffset;
		placed.push({ numeral: request.numeral, part: request.part, surface: true, x, y, box: numeralBox(request.numeral, x, y, fontSize) });
	}
	const marks = requests.filter(item => item.mark && !item.surface).flatMap(item => centreMarkLines(item.anchor));
	const blocking = [...obstacles, ...marks];
	const visible = edges.map(edge => edge.segment);
	const centre: Vec2 = [drawing.x + drawing.width / 2, drawing.y + drawing.height / 2];
	const angleOf = (point: Vec2) => Math.atan2(point[1] - centre[1], point[0] - centre[0]);
	const ordered = requests.filter(item => !item.surface).sort((a, b) => angleOf(a.anchor) - angleOf(b.anchor) || a.numeral.localeCompare(b.numeral));
	const candidates = ringCandidates(drawing);
	for (const request of ordered) {
		const partEdges = edges.filter(edge => edge.part === request.part).map(edge => edge.segment);
		const target = leadTarget(request, partEdges, convexHull(partEdges.flat()));
		const near = target.arms ? request.anchor : target.end;
		const byDistance = candidates
			.map((point, index) => ({ point, index, distance: Math.hypot(point[0] - near[0], point[1] - near[1]) }))
			.sort((a, b) => a.distance - b.distance || a.index - b.index);
		let preferred: PlacedNumeral | undefined;
		let notAlong: PlacedNumeral | undefined;
		let clearOnly: PlacedNumeral | undefined;
		let fallback: PlacedNumeral | undefined;
		for (const { point } of byDistance) {
			const x = point[0];
			const y = point[1] + glyphOffset;
			const box = numeralBox(request.numeral, x, y, fontSize);
			const own = target.arms ? armTarget(target, point) : target;
			const lead: Segment = [leadStart(box, own.end), own.end];
			const candidate: PlacedNumeral = { ...request, x, y, box, lead, centreMark: request.mark ? request.anchor : undefined };
			fallback ??= candidate;
			const clear = inflate(box, CLEARANCE);
			if (placed.some(other => rectsOverlap(clear, other.box) || (other.lead && segmentHitsRect(other.lead, clear)))) {
				continue;
			}
			if (blocking.some(segment => segmentHitsRect(segment, clear))) {
				continue;
			}
			if (placed.some(other => (other.lead && segmentsIntersect(lead, other.lead)) || segmentHitsRect(lead, inflate(other.box, 0.3)))) {
				continue;
			}
			clearOnly ??= candidate;
			if (visible.some(segment => leadRunsAlong(lead, segment))) {
				continue;
			}
			notAlong ??= candidate;
			if (approachPreferred(lead, own)) {
				preferred = candidate;
				break;
			}
		}
		const result = preferred ?? notAlong ?? clearOnly ?? fallback;
		if (result) {
			placed.push(result);
		}
	}
	return placed;
}
