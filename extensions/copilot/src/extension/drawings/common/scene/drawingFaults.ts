/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DraftFinding } from '../../../tools/common/drafting/finding';
import type { DrawingScene, Vec2 } from './drawingScene';
import { HATCH_NEIGHBOUR_DISTANCE } from '../lineArt/lineArt';
import { DIGIT_HEIGHT_RATIO, insidePosition, LEAD_END_TOLERANCE, leadCrossesEdges, leadRunsAlong, numeralBox } from '../lineArt/numeralPlacer';
import { convexHull, flattenSvgPath, inflate, pointPolygonDistance, pointRectDistance, pointSegmentDistance, Rect, rectsOverlap, Segment, segmentHitsRect, segmentSetsNear, segmentsIntersect, toSegments } from '../lineArt/planar';
import { cameraBasis, faceNames, resolvePort } from './sceneGeometry';

/**
 * A Finding of the drawings engine: a drafting Finding with the formal rule it applies, cited
 * from `docs/research/patent-drawings/01-formal-drawing-rules.md`.
 */
export interface DrawingFinding extends DraftFinding {
	/** The rule text the check applies, e.g. `37 CFR 1.84(q)`. */
	readonly citation: string;
	readonly numeral?: string;
	readonly part?: string;
}

/** The mechanical checks, each with its rule citation (01-formal-drawing-rules.md sections 3, 5 and 9). */
export const DRAWING_RULES = {
	'part-without-numeral': 'CONTEXT.md Figure ("every part drawn has one"); 37 CFR 1.84(p)(5); OJ EPO 2025 A49 Art. 1(2)(i)',
	'numeral-without-port': '37 CFR 1.84(q) ("extend to the feature indicated"); GL A-IX 7.5.1',
	'numeral-not-allowed': '37 CFR 1.84(p)(5); OJ EPO 2025 A49 Art. 1(2)(i); PCT Rule 11.13(l)',
	'numeral-two-parts': '37 CFR 1.84(p)(4); OJ EPO 2025 A49 Art. 1(2)(i); PCT Rule 11.13(m)',
	'lead-lines-cross': '37 CFR 1.84(q) ("Lead lines must not cross each other")',
	'lead-line-off-part': '37 CFR 1.84(q) ("extend to the feature indicated"); GL A-IX 7.5.1',
	'lead-line-far-from-numeral': '37 CFR 1.84(q) ("originate in the immediate proximity of the reference character")',
	'lead-line-missing': '37 CFR 1.84(q) (lead line required unless the numeral is underlined); PCT IP 5.145',
	'glyph-too-small': '37 CFR 1.84(p)(3); OJ EPO 2025 A49 Art. 1(2)(g); PCT Rule 11.13(h) (0.32 cm minimum)',
	'text-beyond-keywords': '37 CFR 1.84(o); OJ EPO 2025 A49 Art. 1(2)(j) ("a few short keywords"); PCT Rule 11.11; 37 CFR 1.84(k) (no scale text)',
	'numeral-overlap': '37 CFR 1.84(p)(3) ("should not cross or mingle with the lines")',
	'numeral-on-line': '37 CFR 1.84(p)(3) ("should not cross or mingle with the lines", not on hatched surfaces); OJ EPO 2025 A49 Art. 1(2)(b)',
	'hatch-same-as-neighbour': '37 CFR 1.84(h)(3) ("regularly spaced oblique parallel lines"; juxtaposed parts hatched differently); OJ EPO 2025 A49 Art. 1(2)(b); PCT Rule 11.13(b)',
	'lead-ends-on-nothing': '37 CFR 1.84(q) (lead lines "must originate in the immediate proximity of the reference character and extend to the feature indicated"); OJ EPO 2025 A49 Art. 2',
	'lead-along-edge': '37 CFR 1.84(q) (lead lines "as short as possible", must not cross each other; a lead along an edge reads as the edge); OJ EPO 2025 A49 Art. 2',
	'lead-crosses-outline': '37 CFR 1.84(q) (lead lines "as short as possible"); OJ EPO 2025 A49 Art. 2',
} as const;

export type DrawingRule = keyof typeof DRAWING_RULES;

/** Minimum glyph height in millimetres (01-formal-drawing-rules.md section 3). */
export const MIN_GLYPH_HEIGHT = 3.2;
/** A lead line must start within this distance of its numeral, in millimetres. */
const LEAD_START_TOLERANCE = 2;
/** A lead line must end within this distance of its part's outline, in millimetres. */
const LEAD_OFF_PART_TOLERANCE = 0.5;
/** A keyword legend has at most this many words. */
const KEYWORD_MAX_WORDS = 2;

/** The reference numeral format: digits, an optional letter, an optional prime. */
export const NUMERAL_PATTERN = /^\d{1,4}[a-z]?'?$/;

function fault(rule: DrawingRule, message: string, extra: { numeral?: string; part?: string; file?: string; severity?: DrawingFinding['severity'] } = {}): DrawingFinding {
	return { severity: 'Error', rule, message, citation: DRAWING_RULES[rule], ...extra };
}

/** The hatch style that a part's hatch lines show: angle in whole degrees, pitch when two or more lines exist. */
function hatchStyleOf(segments: readonly Segment[]): { angle: number; pitch?: number } {
	const [[x1, y1], [x2, y2]] = segments[0];
	const angle = ((Math.round(Math.atan2(y1 - y2, x2 - x1) * 180 / Math.PI) % 180) + 180) % 180;
	const radians = angle * Math.PI / 180;
	const offsets = [...new Set(segments.map(([[x, y]]) => Math.round((x * Math.sin(radians) + y * Math.cos(radians)) * 20) / 20))].sort((a, b) => a - b);
	const gaps = offsets.slice(1).map((offset, i) => offset - offsets[i]).filter(gap => gap > 0.1);
	return { angle, pitch: gaps.length ? Math.round(Math.min(...gaps) * 10) / 10 : undefined };
}

/**
 * The scene half of the mechanical fault list: a part without a numeral, a numeral whose port does
 * not resolve, a numeral outside the allowed set (the figures list), and one numeral on two
 * different parts. `allowedNumerals` omitted skips the allowed-set check.
 */
export function checkSceneFaults(scene: DrawingScene, allowedNumerals?: readonly string[]): DrawingFinding[] {
	const file = `${scene.figure}.scene.json`;
	const findings: DrawingFinding[] = [];
	const parts = new Map(scene.parts.map(part => [part.id, part]));
	const camera = cameraBasis(scene.camera);
	for (const part of scene.parts) {
		if (!scene.numerals.some(port => port.part === part.id)) {
			findings.push(fault('part-without-numeral', `Part "${part.id}" is drawn but has no reference numeral.`, { part: part.id, file }));
		}
	}
	for (const port of scene.numerals) {
		const part = parts.get(port.part);
		const names = part && faceNames(part.shape);
		const faceKnown = part !== undefined && (names === undefined ? port.point !== undefined : names.includes(port.face) || port.point !== undefined);
		if (!part || !faceKnown || !resolvePort(port, part, camera)) {
			const reason = !part ? `part "${port.part}" does not exist` : names === undefined ? `a code part needs a "point"` : `part "${port.part}" has no face "${port.face}" (faces: ${names?.join(', ')})`;
			findings.push(fault('numeral-without-port', `Numeral ${port.numeral} has no port: ${reason}.`, { numeral: port.numeral, part: port.part, file }));
		}
		if (allowedNumerals && !allowedNumerals.includes(port.numeral)) {
			findings.push(fault('numeral-not-allowed', `Numeral ${port.numeral} is not in the figures list (allowed: ${allowedNumerals.join(', ') || 'none'}).`, { numeral: port.numeral, part: port.part, file }));
		}
	}
	const identity = (partId: string) => parts.get(partId)?.name ?? partId;
	const seen = new Map<string, string>();
	for (const port of scene.numerals) {
		const previous = seen.get(port.numeral);
		if (previous !== undefined && previous !== identity(port.part)) {
			findings.push(fault('numeral-two-parts', `Numeral ${port.numeral} points at "${previous}" and at "${identity(port.part)}"; one numeral must name one part.`, { numeral: port.numeral, part: port.part, file }));
		} else {
			seen.set(port.numeral, identity(port.part));
		}
	}
	return findings;
}

/** A path or line element of a Figure SVG as the fault list reads it. */
interface SvgPath {
	readonly classes: readonly string[];
	readonly part?: string;
	readonly numeral?: string;
	readonly lines: Vec2[][];
}

/** A text element of a Figure SVG as the fault list reads it. */
interface SvgText {
	readonly className: string;
	readonly part?: string;
	readonly numeral?: string;
	readonly surface: boolean;
	readonly x: number;
	readonly y: number;
	readonly fontSize: number;
	readonly content: string;
}

function attributes(source: string): Map<string, string> {
	const result = new Map<string, string>();
	for (const match of source.matchAll(/(?<name>[\w:-]+)="(?<value>[^"]*)"/g)) {
		result.set(match.groups!.name, match.groups!.value);
	}
	return result;
}

function unescapeXml(text: string): string {
	return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** Reads the paths and texts of a Figure SVG (the format `writeFigureSvg` writes, or an edited copy). */
function readFigureSvg(svg: string): { paths: SvgPath[]; texts: SvgText[] } {
	const paths: SvgPath[] = [];
	for (const match of svg.matchAll(/<(?<tag>path|line|polyline)\b(?<attrs>[^>]*)\/?>/g)) {
		const attrs = attributes(match.groups!.attrs);
		const coordinate = (name: string) => Number(attrs.get(name) ?? 0);
		const points = (attrs.get('points') ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
		const lines: Vec2[][] = match.groups!.tag === 'path'
			? flattenSvgPath(attrs.get('d') ?? '')
			: match.groups!.tag === 'line'
				? [[[coordinate('x1'), coordinate('y1')], [coordinate('x2'), coordinate('y2')]]]
				: [Array.from({ length: Math.floor(points.length / 2) }, (_, i): Vec2 => [points[2 * i], points[2 * i + 1]])];
		paths.push({ classes: (attrs.get('class') ?? '').split(/\s+/).filter(Boolean), part: attrs.get('data-part'), numeral: attrs.get('data-numeral'), lines });
	}
	const texts: SvgText[] = [];
	for (const match of svg.matchAll(/<text\b(?<attrs>[^>]*)>(?<content>[\s\S]*?)<\/text>/g)) {
		const attrs = attributes(match.groups!.attrs);
		texts.push({
			className: attrs.get('class') ?? '',
			part: attrs.get('data-part'),
			numeral: attrs.get('data-numeral'),
			surface: attrs.get('data-surface') === 'true',
			x: Number(attrs.get('x') ?? 0),
			y: Number(attrs.get('y') ?? 0),
			fontSize: Number.parseFloat(attrs.get('font-size') ?? '0'),
			content: unescapeXml(match.groups!.content.replace(/<[^>]+>/g, '')).trim(),
		});
	}
	return { paths, texts };
}

/** The hatch lines of each part, with the style they show. */
function hatchedParts(paths: readonly SvgPath[]): { part: string; segments: Segment[]; style: { angle: number; pitch?: number } }[] {
	const hatches = new Map<string, Segment[]>();
	for (const path of paths.filter(item => item.classes.includes('hatch') && item.part)) {
		hatches.set(path.part!, [...(hatches.get(path.part!) ?? []), ...toSegments(path.lines)]);
	}
	return [...hatches].filter(([, segments]) => segments.length > 0).map(([part, segments]) => ({ part, segments, style: hatchStyleOf(segments) }));
}

/**
 * The hatch style each hatched part of a Figure SVG shows, read back from its hatch lines: angle
 * in whole degrees and pitch in sheet millimetres (absent when the part has one hatch line).
 */
export function figureHatchStyles(svg: string): Record<string, { angle: number; pitch?: number }> {
	return Object.fromEntries(hatchedParts(readFigureSvg(svg).paths).map(item => [item.part, item.style]));
}

/** Options of the SVG fault list runner. */
export interface FigureSvgCheckOptions {
	/** The file name the Findings name, e.g. `FIG-1.svg`. */
	readonly file?: string;
	/** Run only these checks (a diagram has no parts, so it may skip `lead-line-off-part`). Default: all. */
	readonly checks?: readonly DrawingRule[];
}

/**
 * The SVG half of the mechanical fault list, run on the written file before any model sees a
 * render: crossing lead lines, a lead line that ends off its part, on no visible edge or centre mark,
 * runs along a visible edge, or starts far from its numeral, a lead that crosses its own part's
 * outline while the numeral would fit inside it (a Note, found with the placer's own `insidePosition`),
 * a numeral without a lead line that is not underlined, a glyph under 3.2 mm, text beyond
 * keywords, and a numeral that overlaps another numeral or a line. It reads any SVG in the Figure
 * contract (paths, lines, texts with `class` and `data-*`), imports no kernel, and so also runs on
 * the 2D diagram mode's SVG. A lead line without `data-part` skips the on-part check.
 */
export function checkFigureSvgFaults(svg: string, options: FigureSvgCheckOptions = {}): DrawingFinding[] {
	const { paths, texts } = readFigureSvg(svg);
	const file = options.file;
	const findings: DrawingFinding[] = [];
	const numerals = texts.filter(text => text.className === 'numeral' || NUMERAL_PATTERN.test(text.content));
	const boxes = new Map<SvgText, Rect>(numerals.map(text => [text, numeralBox(text.content, text.x, text.y, text.fontSize)]));
	const leads = paths.filter(path => path.classes.includes('lead')).map(path => ({ path, segment: toSegments(path.lines)[0] })).filter((lead): lead is { path: SvgPath; segment: Segment } => lead.segment !== undefined);

	for (const text of texts) {
		const glyph = text.fontSize * DIGIT_HEIGHT_RATIO;
		if (glyph < MIN_GLYPH_HEIGHT - 1e-6) {
			findings.push(fault('glyph-too-small', `Text "${text.content}" is ${glyph.toFixed(2)} mm high; the minimum is ${MIN_GLYPH_HEIGHT} mm.`, { numeral: text.numeral, file }));
		}
		if (!numerals.includes(text)) {
			const words = text.content.split(/\s+/).filter(Boolean);
			if (words.length > KEYWORD_MAX_WORDS || /\bscale\b|actual size/i.test(text.content)) {
				findings.push(fault('text-beyond-keywords', `Text "${text.content}" is more than a short keyword; a Figure carries reference numerals and at most a few short keywords.`, { file }));
			}
		}
	}

	for (let i = 0; i < leads.length; i++) {
		for (let j = i + 1; j < leads.length; j++) {
			if (segmentsIntersect(leads[i].segment, leads[j].segment)) {
				findings.push(fault('lead-lines-cross', `The lead lines of numerals ${leads[i].path.numeral} and ${leads[j].path.numeral} cross.`, { numeral: leads[i].path.numeral, file }));
			}
		}
	}

	const outlines = new Map<string, Vec2[]>();
	for (const path of paths.filter(item => item.classes.includes('edge') && item.part)) {
		outlines.set(path.part!, [...(outlines.get(path.part!) ?? []), ...path.lines.flat()]);
	}
	const visibleEdges = paths.filter(item => item.classes.includes('edge')).flatMap(item => toSegments(item.lines));
	const endTargets = [...visibleEdges, ...paths.filter(item => item.classes.includes('mark')).flatMap(item => toSegments(item.lines))];
	const lineSegments = paths.filter(path => !path.classes.includes('lead') && !path.classes.includes('underline')).flatMap(path => toSegments(path.lines));
	for (const { path, segment } of leads) {
		const offPart = path.part !== undefined && pointPolygonDistance(segment[1], convexHull(outlines.get(path.part) ?? [])) > LEAD_OFF_PART_TOLERANCE;
		if (offPart) {
			findings.push(fault('lead-line-off-part', `The lead line of numeral ${path.numeral} ends off part "${path.part}".`, { numeral: path.numeral, part: path.part, file }));
		} else if (!endTargets.some(target => pointSegmentDistance(segment[1], target) <= LEAD_END_TOLERANCE + 1e-6)) {
			findings.push(fault('lead-ends-on-nothing', `The lead line of numeral ${path.numeral} ends on no visible edge and no centre mark; it must end on the feature it names.`, { numeral: path.numeral, part: path.part, file }));
		}
		if (visibleEdges.some(edge => leadRunsAlong(segment, edge))) {
			findings.push(fault('lead-along-edge', `The lead line of numeral ${path.numeral} runs along a visible edge; it must meet the edge at an angle.`, { numeral: path.numeral, part: path.part, file }));
		}
		const text = numerals.find(item => item.numeral === path.numeral && item.part === path.part) ?? numerals.find(item => item.content === path.numeral);
		const box = text && boxes.get(text);
		if (!box || pointRectDistance(segment[0], box) > LEAD_START_TOLERANCE) {
			findings.push(fault('lead-line-far-from-numeral', `The lead line of numeral ${path.numeral} does not start beside the numeral.`, { numeral: path.numeral, part: path.part, file }));
		}
	}

	for (const { path, segment } of leads) {
		const partEdges = path.part === undefined ? [] : paths.filter(item => item.classes.includes('edge') && item.part === path.part).flatMap(item => toSegments(item.lines));
		if (!partEdges.length || !leadCrossesEdges(segment, partEdges)) {
			continue;
		}
		const own = (item: { numeral?: string; part?: string }) => item.numeral === path.numeral && item.part === path.part;
		const mark = paths.find(item => item.classes.includes('mark') && own(item))?.lines[0];
		const anchor: Vec2 = mark && mark.length >= 2 ? [(mark[0][0] + mark[mark.length - 1][0]) / 2, (mark[0][1] + mark[mark.length - 1][1]) / 2] : segment[1];
		const text = numerals.find(own);
		const others = numerals.filter(item => item !== text).map(item => ({ box: boxes.get(item)!, lead: leads.find(lead => lead.path.numeral === (item.numeral ?? item.content) && lead.path.part === item.part)?.segment }));
		const obstacles = { segments: lineSegments, visible: visibleEdges, numerals: others };
		const request = { numeral: path.numeral ?? '', part: path.part!, anchor, surface: false, mark: mark !== undefined };
		if (insidePosition(request, partEdges, obstacles, text?.fontSize)) {
			findings.push(fault('lead-crosses-outline', `The lead line of numeral ${path.numeral} crosses the outline of part "${path.part}", but the numeral fits inside the outline next to its feature with a short lead.`, { numeral: path.numeral, part: path.part, file, severity: 'Note' }));
		}
	}

	const underlined = new Set(paths.filter(path => path.classes.includes('underline')).map(path => path.numeral));
	for (const text of numerals) {
		const hasLead = leads.some(lead => lead.path.numeral === (text.numeral ?? text.content) && (text.part === undefined || lead.path.part === text.part));
		if (!hasLead && !(text.surface && underlined.has(text.numeral ?? text.content))) {
			findings.push(fault('lead-line-missing', `Numeral ${text.content} has no lead line and is not underlined as a surface.`, { numeral: text.numeral ?? text.content, file }));
		}
	}

	for (let i = 0; i < numerals.length; i++) {
		const box = boxes.get(numerals[i])!;
		for (let j = i + 1; j < numerals.length; j++) {
			if (rectsOverlap(box, boxes.get(numerals[j])!)) {
				findings.push(fault('numeral-overlap', `Numerals ${numerals[i].content} and ${numerals[j].content} overlap.`, { numeral: numerals[i].content, file }));
			}
		}
		const own = (lead: { path: SvgPath }) => lead.path.numeral === numerals[i].numeral && lead.path.part === numerals[i].part;
		const shrunk = inflate(box, -0.1);
		if (lineSegments.some(segment => segmentHitsRect(segment, shrunk)) || leads.some(lead => !own(lead) && segmentHitsRect(lead.segment, shrunk))) {
			findings.push(fault('numeral-on-line', `Numeral ${numerals[i].content} sits on a drawn line.`, { numeral: numerals[i].content, file }));
		}
	}
	const hatched = hatchedParts(paths);
	for (let i = 0; i < hatched.length; i++) {
		for (let j = i + 1; j < hatched.length; j++) {
			const [a, b] = [hatched[i], hatched[j]];
			const same = a.style.angle === b.style.angle && a.style.pitch !== undefined && b.style.pitch !== undefined && Math.abs(a.style.pitch - b.style.pitch) < 0.25;
			if (same && segmentSetsNear(a.segments, b.segments, HATCH_NEIGHBOUR_DISTANCE)) {
				findings.push(fault('hatch-same-as-neighbour', `Parts "${a.part}" and "${b.part}" touch and have the same hatch (${a.style.angle}°, ${a.style.pitch} mm); they read as one body.`, { part: b.part, file, severity: 'Note' }));
			}
		}
	}

	const checks = options.checks;
	return checks ? findings.filter(finding => checks.includes(finding.rule as DrawingRule)) : findings;
}
