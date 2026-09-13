/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generated provenance for a landscape report. A landscape report is a page of numbers, and a number
 * whose origin is not recorded cannot be checked by the reader. This module derives two things from
 * the session's execution record and states them in the saved document:
 *
 * - which figures in the body appear in the text an analytics or search tool actually returned, and
 * - which tables state the unit they count (families, applications, publications, hits).
 *
 * Neither check rejects a save. A figure that is not found may be a correct hand calculation, and a
 * table without a basis word may state it in prose above. Both are disclosures: they tell the reader
 * what was not mechanically traced back to a recorded tool output.
 *
 * Kept free of `vscode` and of the extension's service graph, like {@link patentSecondRead}: the
 * ledger snapshot is described here by a structural type that the real `PatentExecutionSnapshot` is
 * assignable to, so the shaping is unit-testable in isolation.
 */

/** One recorded tool outcome, reduced to what figure provenance needs. */
export interface LandscapeExecution {
	readonly kind: string;
	readonly status: string;
	/** Analytics records only: the tool that produced the rows. */
	readonly tool?: string;
	/** Analytics records only: the request (criteria or SQL) the rows answer. */
	readonly request?: string;
	readonly rowCount?: number;
	/** Analytics records only: the PATSTAT edition the rows were computed from. */
	readonly dataEdition?: string;
	/** Analytics records only: the exact text returned to the model. */
	readonly resultText?: string;
	readonly summary?: string;
	readonly total?: number;
	readonly returned?: number;
}

/** The execution record as far as this module is concerned. */
export interface LandscapeSnapshot {
	readonly executions: readonly LandscapeExecution[];
}

/** Figures traced back to a recorded tool output, and figures that were not. */
export interface FigureProvenance {
	readonly matched: readonly string[];
	readonly unmatched: readonly string[];
}

/** Words that name what a column counts; one of them must appear at or just above a table. */
const BASIS_WORDS = /\b(?:families|family|applications|publications|hits|documents|grants|filings)\b/i;

/** How many lines above a table header may carry the counting basis for it. */
const BASIS_LOOKBACK = 3;

/** Unmatched figures named in the report; the rest are counted. */
const LISTED_FIGURES = 12;

/** How much of a recorded request is repeated in the data provenance appendix. */
const REQUEST_LENGTH = 160;

/** Spans whose digits identify a document rather than measure anything. */
const IDENTIFIER_SPAN = /\]\([^)]*\)|\b[a-z][\w+.-]*:\/\/[^\s)\]]+|\b[A-HY]\d{2}[A-Z]\s?\d{1,4}\/\d{1,6}\b/gi;

/** A bare number, with or without thousands separators, a decimal part, or a percent sign. */
const PURE_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/;

/** The digits of a figure, without separators, percent sign, decimal point or leading zeros. */
function digits(figure: string): string {
	return figure.replace(/[,%.]/g, '').replace(/^0+(?=\d)/, '');
}

/** A calendar year rather than a measurement: four digits, no decimal or percent, within living filing history. */
function isYear(figure: string): boolean {
	if (!/^\d{4}$/.test(figure)) {
		return false;
	}
	const value = Number(figure);
	return value >= 1900 && value <= 2099;
}

/**
 * Every figure stated in the report body, in order of first appearance and in the form it is written.
 *
 * A figure is a token that is nothing but a number: that excludes publication numbers, classification
 * codes, anchors and URLs, whose digits identify a document rather than count anything. Numbers with a
 * single digit are left out (they are ordinals and row counts far more often than findings), as are
 * four-digit years, which a landscape report states on every trend row.
 */
export function extractFigures(content: string): readonly string[] {
	const masked = content.replace(IDENTIFIER_SPAN, ' ');
	const seen = new Set<string>();
	const figures: string[] = [];
	for (const raw of masked.split(/[\s|]+/)) {
		const token = raw.replace(/^[^\w]+/, '').replace(/[^\w%]+$/, '');
		if (!PURE_NUMBER.test(token) || isYear(token) || digits(token).length < 2) {
			continue;
		}
		const key = digits(token) + (token.endsWith('%') ? '%' : '');
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		figures.push(token);
	}
	return figures;
}

/** `3456` written the way a tool output would group it: `3,456`. */
function grouped(value: string): string {
	return value.replace(/\B(?=(?:\d{3})+$)/g, ',');
}

/** Whether `form` stands alone in `text` rather than inside a longer number. */
function containsNumber(text: string, form: string): boolean {
	return new RegExp(`(?<![\\d.,])${form.replace(/\./g, '\\.')}(?![\\d,]|\\.\\d)`).test(text);
}

/**
 * Look each figure up in what the tools actually returned: the recorded result text of succeeded
 * analytics calls, and the totals and returned counts of succeeded searches.
 *
 * A match is evidence that the number was read off a tool output, not that the reading was right; a
 * miss is not proof the figure is wrong, only that it was not traced.
 */
export function figureProvenance(figures: readonly string[], snapshot: LandscapeSnapshot): FigureProvenance {
	const succeeded = snapshot.executions.filter(execution => execution.status === 'succeeded');
	const haystack = succeeded.filter(execution => execution.kind === 'analytics').map(execution => execution.resultText ?? '').join('\n');
	const counts = new Set(succeeded.flatMap(execution => [execution.total, execution.returned, execution.rowCount]).filter((value): value is number => typeof value === 'number').map(String));
	const matched: string[] = [];
	const unmatched: string[] = [];
	for (const figure of figures) {
		const bare = figure.replace(/[,%]/g, '');
		const forms = new Set([bare, grouped(bare.split('.')[0]) + (bare.includes('.') ? '.' + bare.split('.')[1] : '')]);
		const found = counts.has(bare) || [...forms].some(form => containsNumber(haystack, form));
		(found ? matched : unmatched).push(figure);
	}
	return { matched, unmatched };
}

/**
 * The first header cell of every markdown table whose header row, or the lines just above it, never
 * says what the numbers count. Families, applications and publications differ by large factors, so a
 * table without a stated basis is not comparable with anything.
 */
export function tablesWithoutBasis(content: string): readonly string[] {
	const lines = content.split('\n');
	const named: string[] = [];
	for (let index = 0; index + 1 < lines.length; index++) {
		const header = lines[index];
		if (!/^\s*\|/.test(header) || !/^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(lines[index + 1])) {
			continue;
		}
		const context = [header, ...lines.slice(Math.max(0, index - BASIS_LOOKBACK), index)];
		if (context.some(line => BASIS_WORDS.test(line))) {
			continue;
		}
		named.push(header.split('|').map(cell => cell.trim()).filter(Boolean)[0] ?? 'unnamed table');
	}
	return named;
}

/** `N figures checked against recorded tool outputs; …`, the sentence the report states. */
function figureSentence(provenance: FigureProvenance): string {
	const total = provenance.matched.length + provenance.unmatched.length;
	if (total === 0) {
		return 'No figures were found in the report body; nothing was checked against recorded tool outputs.';
	}
	if (provenance.unmatched.length === 0) {
		return `${total} figures checked against recorded tool outputs; all found.`;
	}
	const listed = provenance.unmatched.slice(0, LISTED_FIGURES).join(', ');
	const rest = provenance.unmatched.length > LISTED_FIGURES ? `, and ${provenance.unmatched.length - LISTED_FIGURES} more` : '';
	return `${total} figures checked against recorded tool outputs; ${provenance.unmatched.length} not found: ${listed}${rest}.`;
}

/**
 * The generated sections appended to a landscape report: what was traced back to the execution record
 * and what was not. The model writes the report; this states where its numbers could be found.
 */
export function renderLandscapeAppendix(content: string, snapshot: LandscapeSnapshot): string {
	const provenance = figureProvenance(extractFigures(content), snapshot);
	const missingBasis = tablesWithoutBasis(content);
	const analytics = snapshot.executions.filter(execution => execution.kind === 'analytics' && execution.status === 'succeeded');
	return [
		'## Figure provenance (generated)',
		'Generated from this session\'s execution record, not supplied by the model. A figure is "found" when it appears in the text a tool returned; that is not a check of what it means, and a figure not found may still be a correct calculation from figures that were.',
		figureSentence(provenance),
		...(missingBasis.length ? [`Tables without a stated counting basis: ${missingBasis.join(', ')}. Families, applications and publications are different units; state which one each table counts.`] : []),
		'',
		'## Data provenance (generated)',
		...(analytics.length
			? analytics.map(execution => `- ${execution.tool ?? 'unknown tool'} — ${(execution.request ?? 'request not recorded').slice(0, REQUEST_LENGTH)} — ${execution.rowCount ?? 'unknown'} rows — ${execution.dataEdition ?? 'data edition not recorded'}`)
			: ['No analytics outcome was recorded for this session, so no figure in this report rests on a recorded aggregate.']),
	].join('\n');
}
