/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The rule ids of the Figure checks of the Drawing Set (PRD 0023), with the formal rule each
 * one cites. The drawings engine raises them; the findings file keeps their waivers. The table
 * lives here so that drafting never imports drawings: drawings depends on drafting, never the
 * reverse (#798).
 */

/** The mechanical checks of a 3D Figure, each with its rule citation (01-formal-drawing-rules.md sections 3, 5 and 9). */
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
	'centre-line-crosses-part': '37 CFR 1.84(l) (lines "uniformly thick and well-defined"; a chain line through another part reads as a line of that part); OJ EPO 2025 A49 Art. 1(2)(b)',
} as const;

/** A rule id of {@link DRAWING_RULES}. */
export type DrawingRule = keyof typeof DRAWING_RULES;

/**
 * The rules of the diagram fault check (flowcharts and block diagrams), one per check, rule id to
 * the citation the receipt shows (01-formal-drawing-rules.md sections 5 and 9).
 */
export const DIAGRAM_RULES = {
	'us-keywords-only': '37 CFR 1.84(o); MPEP 608.02 (legends with "as few words as possible"); PCT Rule 11.11',
	'epo-short-sentence': 'OJ EPO 2025 A49 Art. 1(2)(j); GL A-IX 8 (a short sentence per method step); PCT Rule 11.11',
	'label-overlap': '37 CFR 1.84(p)(1), (p)(3) ("plain and legible", "should not cross or mingle with the lines"); OJ EPO 2025 A49 Art. 1(2)(g); PCT Rule 11.13(h)',
	'numeral-set': '37 CFR 1.84(p)(4), (p)(5); OJ EPO 2025 A49 Art. 1(2)(i) (one item, one character; the drawn set equals the step set)',
	'lead-line': '37 CFR 1.84(q) (a lead line per reference character); OJ EPO 2025 A49 Art. 2; PCT IP 5.145',
	'lead-crosses-edge': '37 CFR 1.84(q) ("Lead lines must not cross each other" or other lines); OJ EPO 2025 A49 Art. 2',
} as const;

/** A rule id of {@link DIAGRAM_RULES}. */
export type DiagramRule = keyof typeof DIAGRAM_RULES;
