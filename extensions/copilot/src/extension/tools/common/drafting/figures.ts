/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The `figures.md` contract of a drafting matter (PRD 0023, slice D4):
 *
 * ```
 * ---
 * numerals: even        # even | hundreds; even when absent
 * pageSize: letter      # A4 | letter; when absent, the office's: letter for US, A4 for EPO and PCT
 * drawingSheets: 2      # optional: the sheet count when no sheets are generated
 * ---
 * ## FIG. 1
 *
 * - 12: housing [F3]
 * - 14: bracket [F5] (proposed from sketches/sketch-2.png)
 * - 16: spring (proposed)
 * ```
 *
 * A part line is a list item `- 12: housing` or a table row `| 12 | housing |`. After the part
 * name, `[F3]` (or `[F3, F5]`) links the part to rows of `feature-list.md`, and `(proposed)` marks
 * a part the disclosure does not state: the attorney confirms it by removing the marker. A
 * proposal may name its source, `(proposed from sketches/sketch-2.png)`.
 *
 * Numeral schemes: `even` gives every part an even numeral (2, 4, 6, ...). `hundreds` gives a
 * part a numeral whose hundreds digit is the number of the figure where it first appears
 * (102, 104 in FIG. 1; 202 in FIG. 2).
 */

import { DraftingFrontmatterFields, parseDraftingFrontmatter } from './frontmatter';

/** The numeral scheme of `figures.md`. */
export type NumeralScheme = 'even' | 'hundreds';

/** The sheet size of the Drawing Sheets. */
export type DrawingPageSize = 'A4' | 'letter';

/** A frontmatter key of `figures.md` with a fixed set of values. */
type FiguresSettingKey = 'numerals' | 'pageSize';

/** The frontmatter settings of `figures.md`, with their defaults. */
export interface FiguresSettings {
	readonly numerals: NumeralScheme;
	readonly pageSize: DrawingPageSize;
	/** The keys whose value is not a known value; their default is used. */
	readonly invalid: readonly FiguresSettingKey[];
}

/** A part the disclosure does not state, proposed for the attorney to confirm. */
export interface FigurePartProposal {
	/** Where the proposal came from, e.g. `sketches/sketch-2.png`. */
	readonly source?: string;
}

/** The part name of a part line and its markers. */
export interface FigurePartMarkers {
	readonly part: string;
	/** The Feature List rows the part links, e.g. `F3`; absent when the line links none. */
	readonly features?: readonly string[];
	/** Set when the line carries `(proposed)`. */
	readonly proposed?: FigurePartProposal;
}

/** One part line to write, see {@link formatFigurePart}. */
interface FigurePartLine extends FigurePartMarkers {
	readonly numeral: string;
}

const featureLinkPattern = /\s*\[(?<ids>F\d+(?:\s*,\s*F\d+)*)\]\s*$/;
const proposalPattern = /\s*\(proposed(?:\s+from\s+(?<source>[^)]+?))?\s*\)\s*$/i;

/**
 * Splits the text after the numeral of a part line into the part name, the Feature List links
 * and the proposal marker. The markers stand after the name, in any order:
 * `housing [F3] (proposed from sketches/sketch-2.png)`.
 */
export function readPartMarkers(text: string): FigurePartMarkers {
	let part = text.trim();
	const features: string[] = [];
	let proposed: FigurePartProposal | undefined;
	let match = featureLinkPattern.exec(part) ?? proposalPattern.exec(part);
	while (match) {
		if (match.groups?.ids !== undefined) {
			features.unshift(...match.groups.ids.split(',').map(id => id.trim()));
		} else {
			const source = match.groups?.source?.trim();
			proposed = source ? { source } : {};
		}
		part = part.slice(0, match.index).trimEnd();
		match = featureLinkPattern.exec(part) ?? proposalPattern.exec(part);
	}
	return {
		part,
		...(features.length ? { features: [...new Set(features)] } : {}),
		...(proposed ? { proposed } : {}),
	};
}

/** Writes one part line of `figures.md`: `- 14: bracket [F3] (proposed from sketches/sketch-2.png)`. */
export function formatFigurePart(line: FigurePartLine): string {
	const links = line.features?.length ? ` [${line.features.join(', ')}]` : '';
	const proposal = line.proposed ? (line.proposed.source ? ` (proposed from ${line.proposed.source})` : ' (proposed)') : '';
	return `- ${line.numeral}: ${line.part}${links}${proposal}`;
}

/** Reads one setting; a missing key gives the default, an unknown value gives the default and `valid: false`. */
function readSetting<T extends string>(fields: DraftingFrontmatterFields, key: FiguresSettingKey, values: readonly T[], fallback: T): { readonly value: T; readonly valid: boolean } {
	const raw = fields[key];
	if (raw === undefined || raw === null) {
		return { value: fallback, valid: true };
	}
	const value = typeof raw === 'string' ? values.find(candidate => candidate.toLowerCase() === raw.trim().toLowerCase()) : undefined;
	return value ? { value, valid: true } : { value: fallback, valid: false };
}

/**
 * Reads `numerals` (`even` | `hundreds`, default `even`) and `pageSize` (`A4` | `letter`) from the
 * frontmatter of `figures.md`, case-insensitive. `pageSize` defaults to `officePageSize`, the page
 * of the office's export (`officeDrawingPageSize` in filingDocuments.ts: letter for US, A4 for EPO
 * and PCT); a value in the frontmatter wins. An unknown value gives the default and is listed in
 * `invalid`.
 */
export function readFiguresSettings(figures: string, officePageSize: DrawingPageSize = 'A4'): FiguresSettings {
	const { fields } = parseDraftingFrontmatter(figures);
	const numerals = readSetting<NumeralScheme>(fields, 'numerals', ['even', 'hundreds'], 'even');
	const pageSize = readSetting<DrawingPageSize>(fields, 'pageSize', ['A4', 'letter'], officePageSize);
	const invalid: FiguresSettingKey[] = [];
	if (!numerals.valid) {
		invalid.push('numerals');
	}
	if (!pageSize.valid) {
		invalid.push('pageSize');
	}
	return { numerals: numerals.value, pageSize: pageSize.value, invalid };
}
