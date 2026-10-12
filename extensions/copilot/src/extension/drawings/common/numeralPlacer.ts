/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Vec2 } from './drawingScene';
import { inflate, Rect, rectsOverlap, Segment, segmentHitsRect, segmentsIntersect } from './planar';

/**
 * Numeral font size in sheet millimetres. Digit height in Liberation Sans and Arial is 0.716 of the
 * font size, so 4.5 mm gives 3.22 mm digits: over the 3.2 mm minimum of 37 CFR 1.84(p)(3),
 * OJ EPO 2025 A49 Art. 1(2)(g) and PCT Rule 11.13(h).
 */
export const NUMERAL_FONT_SIZE = 4.5;

/** Digit (and capital) height as a fraction of the font size, Liberation Sans and Arial metrics. */
export const DIGIT_HEIGHT_RATIO = 0.716;

/** Mean digit advance as a fraction of the font size (every digit is 0.556 em in Arial). */
export const DIGIT_WIDTH_RATIO = 0.556;

/** Gap in millimetres between a numeral and the start of its lead line. */
export const LEAD_GAP = 0.8;

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
}

/** A placed numeral: text centred on `x` with its baseline at `y`, and its lead line. */
export interface PlacedNumeral {
	readonly numeral: string;
	readonly part: string;
	readonly x: number;
	readonly y: number;
	readonly box: Rect;
	readonly surface: boolean;
	/** From beside the numeral to the anchor. Absent for a surface numeral. */
	readonly lead?: Segment;
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

/**
 * Places numerals on rings of candidate positions around the drawing. Deterministic: numerals are
 * taken in angular order around the drawing centre, candidates by distance to the anchor, and the
 * first candidate is kept whose numeral clears the drawing and the other numerals and whose lead
 * line crosses no other lead line or numeral. When no candidate clears, the nearest one is kept and
 * the mechanical fault list reports the clash.
 */
export function placeNumerals(requests: readonly NumeralRequest[], obstacles: readonly Segment[], drawing: Rect, fontSize = NUMERAL_FONT_SIZE): PlacedNumeral[] {
	const placed: PlacedNumeral[] = [];
	const glyphOffset = DIGIT_HEIGHT_RATIO * fontSize / 2;
	for (const request of requests.filter(item => item.surface)) {
		const x = request.anchor[0];
		const y = request.anchor[1] + glyphOffset;
		placed.push({ ...request, x, y, box: numeralBox(request.numeral, x, y, fontSize) });
	}
	const centre: Vec2 = [drawing.x + drawing.width / 2, drawing.y + drawing.height / 2];
	const angleOf = (point: Vec2) => Math.atan2(point[1] - centre[1], point[0] - centre[0]);
	const ordered = requests.filter(item => !item.surface).sort((a, b) => angleOf(a.anchor) - angleOf(b.anchor) || a.numeral.localeCompare(b.numeral));
	const candidates = ringCandidates(drawing);
	for (const request of ordered) {
		const byDistance = candidates
			.map((point, index) => ({ point, index, distance: Math.hypot(point[0] - request.anchor[0], point[1] - request.anchor[1]) }))
			.sort((a, b) => a.distance - b.distance || a.index - b.index);
		let chosen: PlacedNumeral | undefined;
		let fallback: PlacedNumeral | undefined;
		for (const { point } of byDistance) {
			const x = point[0];
			const y = point[1] + glyphOffset;
			const box = numeralBox(request.numeral, x, y, fontSize);
			const lead: Segment = [leadStart(box, request.anchor), request.anchor];
			const candidate: PlacedNumeral = { ...request, x, y, box, lead };
			fallback ??= candidate;
			const clear = inflate(box, CLEARANCE);
			if (placed.some(other => rectsOverlap(clear, other.box) || (other.lead && segmentHitsRect(other.lead, clear)))) {
				continue;
			}
			if (obstacles.some(segment => segmentHitsRect(segment, clear))) {
				continue;
			}
			if (placed.some(other => (other.lead && segmentsIntersect(lead, other.lead)) || segmentHitsRect(lead, inflate(other.box, 0.3)))) {
				continue;
			}
			chosen = candidate;
			break;
		}
		const result = chosen ?? fallback;
		if (result) {
			placed.push(result);
		}
	}
	return placed;
}
