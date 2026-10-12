/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftFinding } from '../../../tools/common/drafting/finding';
import { countWords, DiagramOffice, EPO_MAX_WORDS, FONT_SIZE, textWidth, US_MAX_WORDS } from './diagramText';

/** What the fault check compares the SVG against. */
export interface DiagramFaultInput {
	readonly office: DiagramOffice;
	readonly figure: number;
	/** The numerals the step list (or block list) gives, in order. */
	readonly numerals: readonly number[];
}

interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

interface Segment {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
}

interface SvgText {
	readonly attrs: ReadonlyMap<string, string>;
	readonly content: string;
	readonly box: Box;
}

/**
 * Checks a written `FIG-N.svg` diagram: label words per office, overlapping text, the numeral
 * set against the step set, a lead line per numeral, and no numeral or lead line on a
 * connector. Each fault is an Error that cites its rule.
 */
export function checkDiagramSvg(svg: string, input: DiagramFaultInput): DraftFinding[] {
	const file = `FIG-${input.figure}.svg`;
	const findings: DraftFinding[] = [];
	const texts = [...svg.matchAll(/<text (?<attrs>[^>]*)>(?<content>[^<]*)<\/text>/g)].map(match => toText(match.groups?.attrs ?? '', match.groups?.content ?? ''));
	const labels = texts.filter(text => text.attrs.get('class') === 'label');
	const numerals = texts.filter(text => text.attrs.get('class') === 'numeral');
	const paths = [...svg.matchAll(/<path (?<attrs>[^>]*)\/>/g)].map(match => parseAttrs(match.groups?.attrs ?? ''));
	const leads = paths.filter(attrs => attrs.get('class') === 'lead');
	const connectors = paths
		.filter(attrs => attrs.get('data-role') === 'connector')
		.flatMap(attrs => segmentsOf(attrs.get('d') ?? ''));

	// Words per label: keywords only for the US, a short sentence for the EPO.
	const groups = new Map<string, string[]>();
	for (const label of labels) {
		const key = label.attrs.has('data-edge') ? `edge ${label.attrs.get('data-edge')}` : `node ${label.attrs.get('data-node')}`;
		groups.set(key, [...(groups.get(key) ?? []), label.content]);
	}
	const maxWords = input.office === 'US' ? US_MAX_WORDS : EPO_MAX_WORDS;
	for (const [key, lines] of groups) {
		const words = countWords(lines.join(' '));
		if (words > maxWords) {
			findings.push(input.office === 'US'
				? { severity: 'Error', rule: 'us-keywords-only', file, message: `The label of ${key} has ${words} words. A US drawing takes keywords only, at most ${US_MAX_WORDS} words: legends with "as few words as possible" (37 CFR 1.84(o); MPEP 608.02).` }
				: { severity: 'Error', rule: 'epo-short-sentence', file, message: `The label of ${key} has ${words} words. The EPO allows a short sentence per method step, at most ${EPO_MAX_WORDS} words here (Guidelines A-IX 8; OJ EPO 2025 A49 Art. 1(2)(j)).` });
		}
	}

	// No text on other text.
	const all = [...labels, ...numerals];
	for (let i = 0; i < all.length; i++) {
		for (let j = i + 1; j < all.length; j++) {
			if (overlaps(all[i].box, all[j].box)) {
				findings.push({ severity: 'Error', rule: 'label-overlap', file, message: `The text "${all[i].content}" overlaps the text "${all[j].content}". Characters must be plain and legible (37 CFR 1.84(p)(1); PCT Rule 11.13(h)).` });
			}
		}
	}

	// The numeral set equals the step set, and each numeral has its lead line.
	const drawn = numerals.map(text => Number(text.attrs.get('data-numeral')));
	const expected = new Set(input.numerals);
	const missing = input.numerals.filter(numeral => !drawn.includes(numeral));
	const extra = drawn.filter(numeral => !expected.has(numeral));
	if (missing.length || extra.length || drawn.length !== input.numerals.length) {
		findings.push({ severity: 'Error', rule: 'numeral-set', file, message: `The drawn numerals [${drawn.join(', ')}] differ from the step numerals [${input.numerals.join(', ')}]. No character may be absent from the description, and one item takes one character (37 CFR 1.84(p)(4), (p)(5)).` });
	}
	for (const numeral of drawn) {
		const lead = leads.find(attrs => Number(attrs.get('data-numeral')) === numeral);
		if (!lead) {
			findings.push({ severity: 'Error', rule: 'lead-line', file, message: `Numeral ${numeral} has no lead line. A lead line connects each reference character to its item (37 CFR 1.84(q)).` });
			continue;
		}
		const leadSegments = segmentsOf(lead.get('d') ?? '');
		const text = numerals.find(candidate => Number(candidate.attrs.get('data-numeral')) === numeral);
		if (connectors.some(segment => leadSegments.some(leadSegment => crosses(segment, leadSegment)) || (text && segmentInBox(segment, text.box)))) {
			findings.push({ severity: 'Error', rule: 'lead-crosses-edge', file, message: `Numeral ${numeral} or its lead line touches a connector. Lead lines must not cross each other or other lines (37 CFR 1.84(q)).` });
		}
	}
	return findings;
}

function parseAttrs(source: string): Map<string, string> {
	return new Map([...source.matchAll(/(?<name>[\w-]+)="(?<value>[^"]*)"/g)].map(match => [match.groups?.name ?? '', match.groups?.value ?? '']));
}

function num(attrs: ReadonlyMap<string, string>, name: string): number {
	return Number(attrs.get(name) ?? 0);
}

function toText(attrSource: string, raw: string): SvgText {
	const attrs = parseAttrs(attrSource);
	const content = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
	const size = Number(attrs.get('font-size') ?? FONT_SIZE);
	const width = textWidth(content, size);
	const x = num(attrs, 'x');
	const y = num(attrs, 'y');
	const left = attrs.get('text-anchor') === 'middle' ? x - width / 2 : x;
	return { attrs, content, box: { left, right: left + width, top: y - size * 0.8, bottom: y + size * 0.2 } };
}

/** The straight segments of an `M x y L x y ...` path. */
function segmentsOf(d: string): Segment[] {
	const values = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
	const segments: Segment[] = [];
	for (let i = 0; i + 3 < values.length; i += 2) {
		segments.push({ x1: values[i], y1: values[i + 1], x2: values[i + 2], y2: values[i + 3] });
	}
	return segments;
}

function overlaps(a: Box, b: Box): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function segmentInBox(segment: Segment, box: Box): boolean {
	return overlaps({
		left: Math.min(segment.x1, segment.x2), right: Math.max(segment.x1, segment.x2),
		top: Math.min(segment.y1, segment.y2), bottom: Math.max(segment.y1, segment.y2),
	}, { left: box.left - 0.01, right: box.right + 0.01, top: box.top - 0.01, bottom: box.bottom + 0.01 });
}

/** True when two segments intersect (touching ends count). */
function crosses(a: Segment, b: Segment): boolean {
	const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	const d1 = cross(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
	const d2 = cross(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
	const d3 = cross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
	const d4 = cross(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
	if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
		return true;
	}
	const onSegment = (s: Segment, px: number, py: number) => Math.min(s.x1, s.x2) <= px && px <= Math.max(s.x1, s.x2) && Math.min(s.y1, s.y2) <= py && py <= Math.max(s.y1, s.y2);
	return (d1 === 0 && onSegment(b, a.x1, a.y1)) || (d2 === 0 && onSegment(b, a.x2, a.y2)) || (d3 === 0 && onSegment(a, b.x1, b.y1)) || (d4 === 0 && onSegment(a, b.x2, b.y2));
}
