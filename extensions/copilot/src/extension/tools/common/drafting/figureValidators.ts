/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic validators of `figures.md` (PRD 0023, slice D4), beside the reference numeral
 * check of the draft text in `specValidators.ts`: the frontmatter settings, the numeral scheme,
 * the proposal gate and the claimed-feature coverage. No model call.
 */

import { DraftClaim } from './claims';
import { DrawingPageSize, readFiguresSettings } from './figures';
import { OFFICE_PAGE_SETUP, officeDrawingPageSize } from './filingDocuments';
import { DraftFinding } from './finding';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftingOffice, parseDraftingFrontmatter } from './frontmatter';
import { DraftOutline } from './outline';
import { FeatureRow, parseFeatureRows } from './outlineValidators';
import { FigurePart, figureHeadingNumbers, hasFigures, parseFigureParts, parseFigureSections, partNameHasWord } from './specValidators';

const figuresFile = DRAFTING_FILE_NAMES.figures;

/** The rules of one page size per application, per office page. */
const PAGE_SIZE_RULES: Readonly<Record<DrawingPageSize, string>> = {
	letter: '37 CFR 1.52(a)(1)(ii); 37 CFR 1.84(f)',
	A4: 'OJ EPO 2025 A49 Art. 1(1)(a); PCT Rule 11.5',
};

/**
 * Findings of the `figures.md` frontmatter: a Note for a `numerals` or `pageSize` value that is
 * not known (the default is used), and an Error (`page-size-mismatch`) when the page size of the
 * Drawing Sheets differs from the page of the office's export (letter for US, A4 for EPO): one
 * page size per application. Without `pageSize` the sheets use the office's page, so the Error
 * comes only from a value the frontmatter sets.
 */
export function checkFiguresSettings(figures: string, office: DraftingOffice): DraftFinding[] {
	const officePage = officeDrawingPageSize(office);
	const settings = readFiguresSettings(figures, officePage);
	const { fields } = parseDraftingFrontmatter(figures);
	const findings: DraftFinding[] = settings.invalid.map(key => ({
		severity: 'Note',
		rule: 'figures-settings',
		file: figuresFile,
		message: key === 'numerals'
			? `${figuresFile} sets \`numerals: ${String(fields[key])}\`; use \`even\` or \`hundreds\`. The checks use \`even\`.`
			: `${figuresFile} sets \`pageSize: ${String(fields[key])}\`; use \`A4\` or \`letter\`. The sheets use \`${officePage}\`, the page of the ${office} export.`,
	}));
	if (settings.pageSize !== officePage) {
		const setup = OFFICE_PAGE_SETUP[office];
		const why = office === 'EPO' ? ' The EPO accepts A4 sheets only.' : '';
		findings.push({ severity: 'Error', rule: 'page-size-mismatch', file: figuresFile, message: `${figuresFile} sets \`pageSize: ${settings.pageSize}\`, but the ${office} export puts the text on ${setup.paper} (${setup.rule} page setup). One page size per application (${PAGE_SIZE_RULES[officePage]}).${why} Set \`pageSize: ${officePage}\`, or remove the line to use the office default.` });
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
	/** The parsed claims: the Error never offers to remove an independent claim (#783). */
	readonly claims: readonly DraftClaim[];
}

/**
 * The feature a figure must show, for the attorney: the row text with a small initial (an acronym
 * stays) and the row ID, "a spring (F4)"; the row ID alone when the row has no text.
 */
function featureSubject(id: string, text: string | undefined): string {
	const feature = (text ?? '').replace(/[.;,]+$/, '').replace(/^[A-Z](?=[a-z\s])/, initial => initial.toLowerCase());
	return feature ? `${feature} (${id})` : id;
}

/** "claim 4", or "claims 1 and 3". */
function claimList(numbers: readonly number[]): string {
	return numbers.length > 1 ? `claims ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}` : `claim ${numbers[0]}`;
}

/** An alternative embodiment: a prophetic row whose text says "in place of" another feature. */
const alternativePattern = /\bin place of\b/i;

/** The heading of a test or results section of `feature-list.md`. */
const testSectionPattern = /\b(?:tests?|results?)\b/i;

/**
 * True for a Feature List row that is no part to draw: an alternative embodiment (prophetic, "in
 * place of"), or a row of a test or results section (#783). A row `feature-list.md` does not have
 * is reported by the link check, not here.
 */
function notDrawable(row: FeatureRow | undefined): boolean {
	return !!row && ((row.prophetic && alternativePattern.test(row.text)) || testSectionPattern.test(row.section));
}

/** True when a word of a claim term, of three letters or more, is a word of a drawn part name: "spring arranged between" names the part "spring". */
function claimTermsDrawn(terms: readonly string[], drawnParts: readonly FigurePart[]): boolean {
	return terms.some(term => (term.match(/[A-Za-z][A-Za-z-]*/g) ?? []).filter(word => word.length >= 3).some(word => drawnParts.some(part => partNameHasWord(part.part, word))));
}

/**
 * The second action of a coverage Error: remove the claims that cite the row, which re-opens the
 * claims approval. Not offered when one of the claims is independent (#783): the sentence says
 * which claim is independent instead. A claim `claims.md` does not have counts as independent.
 */
function removalAction(numbers: readonly number[], claims: readonly DraftClaim[]): string {
	const independent = numbers.filter(number => !claims.find(claim => claim.number === number)?.dependsOn.length);
	if (!independent.length) {
		return `; or "Remove ${claimList(numbers)} (this re-opens the claims approval)".`;
	}
	const subject = claimList(independent);
	return `. ${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${independent.length > 1 ? 'are' : 'is'} independent, so the claim${numbers.length > 1 ? 's are' : ' is'} not removed.`;
}

/**
 * Claimed-feature coverage through the Feature List links of `figures.md` (37 CFR 1.83(a): the
 * drawings show every feature specified in the claims):
 *
 * - A Technical item of the Draft Outline that lists claims maps claim elements to the Feature
 *   List rows it cites. A row is drawn when a confirmed part (not `(proposed)`) under a figure
 *   heading, or in a list with no heading above it, links it (`- 12: housing [F3]`).
 * - The item is covered when one of its cited rows is drawn, or when a word of one of its claim
 *   terms names a drawn part (`spring arranged between` and the part `spring`) (#783).
 * - For an item that is not covered, an Error for each cited row that is not drawn. An
 *   alternative row (prophetic, "in place of") and a row of a test or results section are not
 *   demanded, unless they are the only rows of the item: then the row is the only source of the
 *   claim element and the Error stays.
 * - An Error for each link to a row that `feature-list.md` does not have.
 * - The Error for a row that is not drawn names the actions of the attorney (PRD 0025, S5): add
 *   a figure of the feature; or, when no citing claim is independent, remove the claims that
 *   cite it, which re-opens the claims approval.
 * - When `figures.md` links no part at all, or the Draft Outline has no Technical item that
 *   lists claims (no outline yet), one Note marked `notChecked` instead: the coverage was not
 *   checked. The receipt of the Drawing Set shows the row as `not-checked` (#804).
 *
 * No finding when the application has no figures. For EPO the gate is the same; the EPC has no
 * rule like 37 CFR 1.83(a), and the message says so.
 */
export function checkClaimedFeatureCoverage(input: FeatureCoverageInput): DraftFinding[] {
	if (!hasFigures(input.figures)) {
		return [];
	}
	const items = input.outline.items
		.filter(item => item.kind === 'Technical' && item.claims.length)
		.map(item => ({ claims: item.claims, claimTerms: item.claimTerms, rows: item.sources.filter(entry => entry.kind === 'feature').map(entry => entry.ref) }))
		.filter(item => item.rows.length);
	const cited = [...new Set(items.flatMap(item => item.rows))];
	const parts = parseFigureParts(input.figures);
	const linked = parts.filter(part => part.features?.length);
	const notChecked = (message: string): DraftFinding => ({ severity: 'Note', rule: 'figure-coverage', file: figuresFile, notChecked: true, message });
	if (!linked.length) {
		return cited.length
			? [notChecked(`${figuresFile} links no part to a Feature List row (\`- 12: housing [F3]\`), so the claimed-feature coverage was not checked. The Approved Claims cite ${cited.join(', ')}.`)]
			: [];
	}
	const findings: DraftFinding[] = [];
	const rows = parseFeatureRows(input.featureList);
	for (const part of linked) {
		for (const feature of part.features ?? []) {
			if (!rows.has(feature)) {
				findings.push({ severity: 'Error', rule: 'figure-coverage', file: figuresFile, line: part.line, message: `Part ${part.numeral} ("${part.part}") links ${feature}, which is not a row of ${DRAFTING_FILE_NAMES.featureList}.` });
			}
		}
	}
	if (!cited.length) {
		findings.push(notChecked(input.outline.items.length
			? `Not checked: ${DRAFTING_FILE_NAMES.draftOutline} has no Technical item that lists claims. The claimed-feature coverage (37 CFR 1.83(a)) is checked once it has.`
			: `Not checked: no Draft Outline yet. The claimed-feature coverage (37 CFR 1.83(a)) is checked once ${DRAFTING_FILE_NAMES.draftOutline} has Technical items that list claims.`));
		return findings;
	}
	const drawnParts = parseFigureSections(input.figures).drawnParts.filter(part => !part.proposed);
	const drawn = new Set(drawnParts.flatMap(part => part.features ?? []));
	const demanded = new Map<string, Set<number>>();
	for (const item of items) {
		if (item.rows.some(row => drawn.has(row)) || claimTermsDrawn(item.claimTerms, drawnParts)) {
			continue;
		}
		const drawable = item.rows.filter(row => !notDrawable(rows.get(row)));
		for (const row of drawable.length ? drawable : item.rows) {
			const claims = demanded.get(row) ?? new Set<number>();
			item.claims.forEach(claim => claims.add(claim));
			demanded.set(row, claims);
		}
	}
	const rule = input.office === 'US'
		? '37 CFR 1.83(a): the drawings must show every feature specified in the claims'
		: 'the Drawing Set gate; the EPC has no rule like 37 CFR 1.83(a)';
	for (const [feature, claims] of demanded) {
		const numbers = [...claims].sort((a, b) => a - b);
		const subject = featureSubject(feature, rows.get(feature)?.text);
		findings.push({ severity: 'Error', rule: 'figure-coverage', file: figuresFile, claim: numbers[0], message: `Feature List row ${feature}, which the Draft Outline cites for claim${numbers.length > 1 ? 's' : ''} ${numbers.join(', ')}, has no drawn part in ${figuresFile} (${rule}). The attorney decides: "Add a figure of ${subject}", then link its part under the figure heading, e.g. "- 20: <part> [${feature}]"${removalAction(numbers, input.claims)}` });
	}
	return findings;
}
