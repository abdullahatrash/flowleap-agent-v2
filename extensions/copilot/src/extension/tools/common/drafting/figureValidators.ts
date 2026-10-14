/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic validators of `figures.md` (PRD 0023, slice D4), beside the reference numeral
 * check of the draft text in `specValidators.ts`: the frontmatter settings, the numeral scheme,
 * the proposal gate and the claimed-feature coverage. No model call.
 */

import { readFiguresSettings } from './figures';
import { DraftFinding } from './finding';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftingOffice, parseDraftingFrontmatter } from './frontmatter';
import { DraftOutline } from './outline';
import { featureRowIds } from './outlineValidators';
import { FigurePart, figureHeadingNumbers, hasFigures, parseFigureParts, parseFigureSections } from './specValidators';

const figuresFile = DRAFTING_FILE_NAMES.figures;

/**
 * Findings of the `figures.md` frontmatter: a Note for a `numerals` or `pageSize` value that is
 * not known (the default is used), and for EPO an Error for `pageSize: letter`: the EPO accepts
 * A4 sheets only (OJ EPO 2025 A49 Art. 2(2)).
 */
export function checkFiguresSettings(figures: string, office: DraftingOffice): DraftFinding[] {
	const settings = readFiguresSettings(figures);
	const { fields } = parseDraftingFrontmatter(figures);
	const findings: DraftFinding[] = settings.invalid.map(key => ({
		severity: 'Note',
		rule: 'figures-settings',
		file: figuresFile,
		message: key === 'numerals'
			? `${figuresFile} sets \`numerals: ${String(fields[key])}\`; use \`even\` or \`hundreds\`. The checks use \`even\`.`
			: `${figuresFile} sets \`pageSize: ${String(fields[key])}\`; use \`A4\` or \`letter\`. The sheets use \`A4\`.`,
	}));
	if (office === 'EPO' && settings.pageSize === 'letter') {
		findings.push({ severity: 'Error', rule: 'figures-settings', file: figuresFile, message: `${figuresFile} sets \`pageSize: letter\`, but the EPO accepts A4 sheets only (OJ EPO 2025 A49 Art. 2(2)). Set \`pageSize: A4\`.` });
	}
	return findings;
}

/** The integer part of a numeral or figure number: `12a` = 12. */
function leadingNumber(text: string): number {
	return Number.parseInt(text, 10);
}

/**
 * Notes when a numeral of `figures.md` does not follow the scheme its `numerals` setting names,
 * once per numeral, at its first line. `even`: every numeral is even (a letter suffix, `12a`, is
 * not read). `hundreds`: the hundreds digit of a numeral is the number of the figure where the
 * numeral first appears (`104` in FIG. 1, `202` in FIG. 2); a numeral under a range heading
 * (`FIGS. 7 to 10`) may take any figure of the range; a part under no figure heading is not
 * checked. The scheme is drafting practice, not an office rule, so the Notes never block export.
 */
export function checkNumeralScheme(figures: string): DraftFinding[] {
	const { numerals } = readFiguresSettings(figures);
	const findings: DraftFinding[] = [];
	const seen = new Set<string>();
	const note = (part: FigurePart, message: string) => findings.push({ severity: 'Note', rule: 'numeral-scheme', file: figuresFile, line: part.line, message });
	if (numerals === 'even') {
		for (const part of parseFigureParts(figures)) {
			if (!seen.has(part.numeral)) {
				seen.add(part.numeral);
				if (leadingNumber(part.numeral) % 2) {
					note(part, `Numeral ${part.numeral} ("${part.part}") is odd, but ${figuresFile} uses the \`numerals: even\` scheme. Give the part an even numeral.`);
				}
			}
		}
		return findings;
	}
	for (const section of parseFigureSections(figures).figures) {
		const numbers = figureHeadingNumbers(section.label).map(leadingNumber);
		for (const part of section.parts) {
			if (seen.has(part.numeral)) {
				continue;
			}
			seen.add(part.numeral);
			if (!numbers.includes(Math.floor(leadingNumber(part.numeral) / 100))) {
				const example = `${numbers[0]}02`;
				note(part, `Numeral ${part.numeral} ("${part.part}") first appears in ${section.label}, but ${figuresFile} uses the \`numerals: hundreds\` scheme: its hundreds digit must be the figure number, e.g. ${example}.`);
			}
		}
	}
	return findings;
}

/**
 * An Error for each `(proposed)` part line of `figures.md`: a part the disclosure does not state
 * is drawn only after the attorney confirms it (ADR 0014). The Error blocks export until the
 * attorney removes the marker or the line.
 */
export function checkFigureProposals(figures: string): DraftFinding[] {
	return parseFigureParts(figures).filter(part => part.proposed).map(part => ({
		severity: 'Error',
		rule: 'figure-proposal',
		file: figuresFile,
		line: part.line,
		message: `Part ${part.numeral} ("${part.part}") is a proposal${part.proposed?.source ? ` from ${part.proposed.source}` : ''}: the disclosure does not state it. The attorney confirms it by removing "(proposed)", or deletes the line.`,
	}));
}

/** The inputs of the claimed-feature coverage check. */
export interface FeatureCoverageInput {
	readonly office: DraftingOffice;
	/** `figures.md`. */
	readonly figures: string;
	/** The parsed Draft Outline: its Technical items map the Approved Claims to Feature List rows. */
	readonly outline: DraftOutline;
	/** `feature-list.md`. */
	readonly featureList: string;
}

/**
 * Claimed-feature coverage through the Feature List links of `figures.md` (37 CFR 1.83(a): the
 * drawings show every feature specified in the claims):
 *
 * - The rows an Approved Claim cites are the Feature List sources of the Technical items of the
 *   Draft Outline that list claims.
 * - A row is drawn when a confirmed part (not `(proposed)`) under a figure heading, or in a
 *   list with no heading above it, links it (`- 12: housing [F3]`).
 * - An Error for each cited row that is not drawn, and for each link to a row that
 *   `feature-list.md` does not have.
 * - When `figures.md` links no part at all, one Note instead: the coverage was not checked.
 *
 * No finding when the application has no figures. For EPO the gate is the same; the EPC has no
 * rule like 37 CFR 1.83(a), and the message says so.
 */
export function checkClaimedFeatureCoverage(input: FeatureCoverageInput): DraftFinding[] {
	if (!hasFigures(input.figures)) {
		return [];
	}
	const cited = new Map<string, Set<number>>();
	for (const item of input.outline.items) {
		if (item.kind !== 'Technical' || !item.claims.length) {
			continue;
		}
		for (const source of item.sources.filter(entry => entry.kind === 'feature')) {
			const claims = cited.get(source.ref) ?? new Set<number>();
			item.claims.forEach(claim => claims.add(claim));
			cited.set(source.ref, claims);
		}
	}
	const parts = parseFigureParts(input.figures);
	const linked = parts.filter(part => part.features?.length);
	if (!linked.length) {
		return cited.size
			? [{ severity: 'Note', rule: 'figure-coverage', file: figuresFile, message: `${figuresFile} links no part to a Feature List row (\`- 12: housing [F3]\`), so the claimed-feature coverage was not checked. The Approved Claims cite ${[...cited.keys()].join(', ')}.` }]
			: [];
	}
	const findings: DraftFinding[] = [];
	const rows = featureRowIds(input.featureList);
	for (const part of linked) {
		for (const feature of part.features ?? []) {
			if (!rows.has(feature)) {
				findings.push({ severity: 'Error', rule: 'figure-coverage', file: figuresFile, line: part.line, message: `Part ${part.numeral} ("${part.part}") links ${feature}, which is not a row of ${DRAFTING_FILE_NAMES.featureList}.` });
			}
		}
	}
	const drawn = new Set(parseFigureSections(input.figures).drawnParts.filter(part => !part.proposed).flatMap(part => part.features ?? []));
	const rule = input.office === 'US'
		? '37 CFR 1.83(a): the drawings must show every feature specified in the claims'
		: 'the Drawing Set gate; the EPC has no rule like 37 CFR 1.83(a)';
	for (const [feature, claims] of cited) {
		if (!drawn.has(feature)) {
			const numbers = [...claims].sort((a, b) => a - b);
			findings.push({ severity: 'Error', rule: 'figure-coverage', file: figuresFile, claim: numbers[0], message: `Feature List row ${feature}, which the Draft Outline cites for claim${numbers.length > 1 ? 's' : ''} ${numbers.join(', ')}, has no drawn part in ${figuresFile}. Link a confirmed part under a figure heading to it, e.g. "- 20: <part> [${feature}]" (${rule}).` });
		}
	}
	return findings;
}
