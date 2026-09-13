/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generated provenance for a landscape report. A landscape report is a page of numbers, and a number
 * whose origin is not recorded cannot be checked by the reader. This module derives three things from
 * the session's execution record and states them in the saved document:
 *
 * - which figures in the body appear in the text an analytics or search tool actually returned,
 * - which of the rest are row totals, column sums or shares of the report's own tables, and
 * - which tables state the unit they count (families, applications, publications, hits).
 *
 * No check rejects a save. A figure that is not found may be a correct hand calculation, and a table
 * without a basis word may state it in prose above. They are disclosures: they tell the reader what
 * was not mechanically traced back to a recorded tool output, and naming the column behind a sum lets
 * a mislabelled period show itself.
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

/** A figure that no tool returned but that follows arithmetically from figures they did. */
export interface DerivedFigure {
	readonly figure: string;
	/** How it follows: `row total`, `column sum of '<header>'`, or `share`. */
	readonly basis: string;
}

/** Figures traced back to a recorded tool output, computed from such figures, or neither. */
export interface FigureProvenance {
	readonly matched: readonly string[];
	readonly derived: readonly DerivedFigure[];
	readonly unmatched: readonly string[];
}

/** A markdown table of the report body, as the arithmetic checks read it. */
interface MarkdownTable {
	readonly headers: readonly string[];
	readonly rows: readonly (readonly string[])[];
}

/** One figure the report's own tables account for. */
interface DerivedValue {
	readonly value: number;
	readonly percent: boolean;
	readonly basis: string;
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

/** A table row, header row or data row, split into trimmed cells. */
function cells(line: string): readonly string[] {
	return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

/**
 * The number a table cell states, or `undefined` when it states none, more than one, or a year. A
 * year labels a row; it is not a quantity, and summing it would make every row total wrong.
 */
function cellValue(cell: string): number | undefined {
	const numbers = cell.split(/\s+/)
		.map(token => token.replace(/^[^\w]+/, '').replace(/[^\w%]+$/, ''))
		.filter(token => PURE_NUMBER.test(token) && !isYear(token));
	return numbers.length === 1 ? Number(numbers[0].replace(/[,%]/g, '')) : undefined;
}

/** Every markdown table in the content, in order. */
function parseTables(content: string): readonly MarkdownTable[] {
	const lines = content.split('\n');
	const tables: MarkdownTable[] = [];
	for (let index = 0; index + 1 < lines.length; index++) {
		if (!/^\s*\|/.test(lines[index]) || !/^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(lines[index + 1])) {
			continue;
		}
		const rows: (readonly string[])[] = [];
		let cursor = index + 2;
		while (cursor < lines.length && /^\s*\|/.test(lines[cursor])) {
			rows.push(cells(lines[cursor]));
			cursor++;
		}
		tables.push({ headers: cells(lines[index]), rows });
		index = cursor - 1;
	}
	return tables;
}

/** Equal as far as a report's rounding goes. */
function near(a: number, b: number): boolean {
	return Math.abs(a - b) < 1e-6;
}

/**
 * The figures the report's own tables account for: row totals, column sums, and percentages that are
 * one cell's share of its column. A landscape report adds up what the tools returned, and the sum is
 * never in the tool output, so arithmetic on recorded figures is stated as such rather than as an
 * untraceable number. Naming the column a sum belongs to makes a mislabelled period visible: a total
 * that matches the 2015-2025 column cannot be the 2015-2023 figure the text calls it.
 */
function derivedValues(tables: readonly MarkdownTable[]): readonly DerivedValue[] {
	const derived: DerivedValue[] = [];
	for (const table of tables) {
		const width = Math.max(table.headers.length, ...table.rows.map(row => row.length));
		const columnSum = (column: number, rows: readonly (readonly string[])[]) => rows.reduce((sum, row) => sum + (cellValue(row[column] ?? '') ?? 0), 0);
		// A stated total is the sum of the rows above it, so a column is summed both ways when the
		// table carries its own total row.
		const total = table.rows.findIndex(row => /^\**\s*(?:total|sum|all)\b/i.test(row[0] ?? ''));
		const above = total === -1 ? table.rows : table.rows.slice(0, total);
		for (let column = 0; column < width; column++) {
			const header = table.headers[column]?.trim() || `column ${column + 1}`;
			for (const rows of total === -1 ? [table.rows] : [above, table.rows]) {
				const counted = rows.map(row => row[column] ?? '').filter(cell => cellValue(cell) !== undefined);
				// A single cell is not a column, and a column of percentages sums to nothing countable.
				if (counted.length < 2 || counted.some(cell => cell.includes('%'))) {
					continue;
				}
				derived.push({ value: columnSum(column, rows), percent: false, basis: `column sum of '${header}'` });
			}
		}
		for (const row of table.rows) {
			const numbers = row
				.map((cell, column) => ({ column, value: cellValue(cell), percent: cell.includes('%') }))
				.filter((entry): entry is { column: number; value: number; percent: boolean } => entry.value !== undefined);
			// Two numbers make every pair a trivial "total" of the other, so a row total needs three.
			if (numbers.length >= 3) {
				const sum = numbers.reduce((running, entry) => running + entry.value, 0);
				for (const entry of numbers.filter(entry => near(entry.value, sum - entry.value))) {
					derived.push({ value: entry.value, percent: entry.percent, basis: 'row total' });
				}
			}
			for (const share of numbers.filter(entry => entry.percent)) {
				for (const part of numbers.filter(entry => !entry.percent)) {
					const sum = columnSum(part.column, above);
					if (sum > 0 && near(Math.round((100 * part.value) / sum), share.value)) {
						derived.push({ value: share.value, percent: true, basis: 'share' });
					}
				}
			}
		}
	}
	return derived;
}

/**
 * Look each figure up in what the tools actually returned: the recorded result text of succeeded
 * analytics calls, and the totals and returned counts of succeeded searches. A figure no tool
 * returned is then checked against the report's own tables, so a row total or a share is reported as
 * computed rather than as unsourced.
 *
 * A match is evidence that the number was read off a tool output, not that the reading was right; a
 * miss is not proof the figure is wrong, only that it was not traced.
 */
export function figureProvenance(figures: readonly string[], snapshot: LandscapeSnapshot, content: string = ''): FigureProvenance {
	const succeeded = snapshot.executions.filter(execution => execution.status === 'succeeded');
	const haystack = succeeded.filter(execution => execution.kind === 'analytics').map(execution => execution.resultText ?? '').join('\n');
	const counts = new Set(succeeded.flatMap(execution => [execution.total, execution.returned, execution.rowCount]).filter((value): value is number => typeof value === 'number').map(String));
	const computed = derivedValues(parseTables(content));
	const matched: string[] = [];
	const derived: DerivedFigure[] = [];
	const unmatched: string[] = [];
	for (const figure of figures) {
		const bare = figure.replace(/[,%]/g, '');
		const forms = new Set([bare, grouped(bare.split('.')[0]) + (bare.includes('.') ? '.' + bare.split('.')[1] : '')]);
		if (counts.has(bare) || [...forms].some(form => containsNumber(haystack, form))) {
			matched.push(figure);
			continue;
		}
		const percent = figure.endsWith('%');
		const basis = computed.find(entry => entry.percent === percent && near(entry.value, Number(bare)));
		if (basis) {
			derived.push({ figure, basis: basis.basis });
		} else {
			unmatched.push(figure);
		}
	}
	return { matched, derived, unmatched };
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
		// Two header cells name the table; the first alone is often "#" or "Rank", which names nothing.
		named.push(cells(header).filter(Boolean).slice(0, 2).join(' | ') || 'unnamed table');
	}
	return named;
}

/** `…, and N more` when a list is longer than what is named. */
function remainder(length: number): string {
	return length > LISTED_FIGURES ? `, and ${length - LISTED_FIGURES} more` : '';
}

/** `N figures checked against recorded tool outputs; …`, the sentence the report states. */
export function figureSentence(provenance: FigureProvenance): string {
	const { matched, derived, unmatched } = provenance;
	const total = matched.length + derived.length + unmatched.length;
	if (total === 0) {
		return 'No figures were found in the report body; nothing was checked against recorded tool outputs.';
	}
	const missing = unmatched.length ? `${unmatched.length} not found: ${unmatched.slice(0, LISTED_FIGURES).join(', ')}${remainder(unmatched.length)}` : '0 not found';
	return `${total} figures checked against recorded tool outputs; ${matched.length} found, ${derived.length} computed from figures that were found, ${missing}.`;
}

/** The totals and shares the report's own tables account for, each with the arithmetic behind it. */
function derivedSentence(derived: readonly DerivedFigure[]): readonly string[] {
	if (!derived.length) {
		return [];
	}
	const listed = derived.slice(0, LISTED_FIGURES).map(entry => `${entry.figure} (${entry.basis})`).join(', ');
	return [`${derived.length} figures are totals or shares computed from recorded figures: ${listed}${remainder(derived.length)}. Check each stated period and label against the column named here.`];
}

/**
 * The generated sections appended to a landscape report: what was traced back to the execution record
 * and what was not. The model writes the report; this states where its numbers could be found.
 */
export function renderLandscapeAppendix(content: string, snapshot: LandscapeSnapshot): string {
	const provenance = figureProvenance(extractFigures(content), snapshot, content);
	const missingBasis = tablesWithoutBasis(content);
	const analytics = snapshot.executions.filter(execution => execution.kind === 'analytics' && execution.status === 'succeeded');
	return [
		'## Figure provenance (generated)',
		'Generated from this session\'s execution record, not supplied by the model. A figure is "found" when it appears in the text a tool returned; that is not a check of what it means, and a figure not found may still be a correct calculation from figures that were.',
		figureSentence(provenance),
		...derivedSentence(provenance.derived),
		...(missingBasis.length ? [`Tables without a stated counting basis: ${missingBasis.join(', ')}. Families, applications and publications are different units; state which one each table counts.`] : []),
		'',
		'## Data provenance (generated)',
		...(analytics.length
			? analytics.map(execution => `- ${execution.tool ?? 'unknown tool'} — ${(execution.request ?? 'request not recorded').slice(0, REQUEST_LENGTH)} — ${execution.rowCount ?? 'unknown'} rows — ${execution.dataEdition ?? 'data edition not recorded'}`)
			: ['No analytics outcome was recorded for this session, so no figure in this report rests on a recorded aggregate.']),
	].join('\n');
}
