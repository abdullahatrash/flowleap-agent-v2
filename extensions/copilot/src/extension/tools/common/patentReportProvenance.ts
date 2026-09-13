/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generated provenance for a saved patent report. A landscape report is a page of numbers, and an
 * FTO memo is a page of legal statuses, dates and quoted claims; a figure, a date or a quotation
 * whose origin is not recorded cannot be checked by the reader. This module derives from the
 * session's execution record, and states in the saved document:
 *
 * - which figures in the body appear in the text an analytics, status or search tool actually returned,
 * - which of the rest are row totals, column sums or shares of the report's own tables,
 * - which tables state the unit they count (families, applications, publications, hits),
 * - which dates appear in the text a tool returned, and
 * - which claim quotations match, word for word, the claim text the record holds for the publication
 *   the quotation is cited to.
 *
 * No check rejects a save. A figure that is not found may be a correct hand calculation, a table
 * without a basis word may state it in prose above, and an unmatched quotation may be a faithful
 * translation or an excerpt of a section the record does not hold. They are disclosures: they tell
 * the reader what was not mechanically traced back to a recorded tool output, and naming the column
 * behind a sum lets a mislabelled period show itself.
 *
 * Kept free of `vscode` and of the extension's service graph, like {@link patentSecondRead}: the
 * ledger snapshot is described here by a structural type that the real `PatentExecutionSnapshot` is
 * assignable to, so the shaping is unit-testable in isolation.
 */

/** One retrieved passage of a document, reduced to what a quotation check needs. */
export interface ProvenanceSource {
	/** The exact text returned for the passage; absent in records written before it was stored. */
	readonly text?: string;
	readonly reference: { readonly publicationNumber: string; readonly section: string };
}

/** One recorded tool outcome, reduced to what report provenance needs. */
export interface ProvenanceExecution {
	readonly kind: string;
	readonly status: string;
	/** Analytics and status records only: the tool that produced the outcome. */
	readonly tool?: string;
	/** Analytics and status records only: the request (criteria, SQL or publication number) it answers. */
	readonly request?: string;
	readonly rowCount?: number;
	/** Analytics records only: the PATSTAT edition the rows were computed from. */
	readonly dataEdition?: string;
	/** Analytics and status records only: the exact text returned to the model. */
	readonly resultText?: string;
	readonly summary?: string;
	readonly total?: number;
	readonly returned?: number;
	/** Search and details records only: the documents the outcome is about. */
	readonly publicationIds?: readonly string[];
	/** Details records only: the passages returned, with the text a quotation is checked against. */
	readonly sources?: readonly ProvenanceSource[];
	/** The query a search outcome answers. */
	readonly query?: string;
}

/** The execution record as far as this module is concerned. */
export interface ProvenanceSnapshot {
	readonly executions: readonly ProvenanceExecution[];
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

/** The text succeeded analytics and status calls returned to the model, as one searchable body. */
function returnedText(snapshot: ProvenanceSnapshot): string {
	return snapshot.executions
		.filter(execution => execution.status === 'succeeded' && (execution.kind === 'analytics' || execution.kind === 'status'))
		.map(execution => execution.resultText ?? '')
		.join('\n');
}

/**
 * Look each figure up in what the tools actually returned: the recorded result text of succeeded
 * analytics and status calls, and the totals and returned counts of succeeded searches. A figure no tool
 * returned is then checked against the report's own tables, so a row total or a share is reported as
 * computed rather than as unsourced.
 *
 * A match is evidence that the number was read off a tool output, not that the reading was right; a
 * miss is not proof the figure is wrong, only that it was not traced.
 */
export function figureProvenance(figures: readonly string[], snapshot: ProvenanceSnapshot, content: string = ''): FigureProvenance {
	const succeeded = snapshot.executions.filter(execution => execution.status === 'succeeded');
	const haystack = returnedText(snapshot);
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
export function renderLandscapeAppendix(content: string, snapshot: ProvenanceSnapshot): string {
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

/** A date as a report writes it: `2024-01-10`, `10.01.2024` or `01/10/2024`. */
const DATE_TOKEN = /(?<!\d)(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?!\d)/g;

/** Dates named in the provenance sentence; the rest are counted. */
const LISTED_DATES = 8;

/** Quotations named in the provenance sentence; the rest are counted. */
const LISTED_QUOTATIONS = 6;

/** How much of an unmatched quotation the report repeats, so the reader can find it in the body. */
const QUOTATION_EXCERPT = 80;

/** The shortest quoted span a claim check judges; anything shorter is a term, not a quotation. */
const QUOTATION_LENGTH = 40;

/** How far after a claims citation a quotation may begin and still belong to that citation. */
const QUOTATION_WINDOW = 300;

/** How far past the window a quotation that begins inside it may run before it is read as prose. */
const QUOTATION_TAIL = 2_000;

/** A calendar day, however the report wrote it. */
interface CalendarDate {
	readonly year: string;
	readonly month: string;
	readonly day: string;
}

/**
 * The day a written date names, or `undefined` when the numbers are not a day of a month. The dotted
 * form is read day-first (European offices and EPO OPS) and the slashed form month-first (US), which
 * is how each is written in the sources these reports quote; a form the record states the other way
 * round simply does not match, and is disclosed rather than silently accepted.
 */
function parseDate(written: string): CalendarDate | undefined {
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(written);
	const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(written);
	const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(written);
	const parts = iso ? { year: iso[1], month: iso[2], day: iso[3] }
		: dotted ? { year: dotted[3], month: dotted[2], day: dotted[1] }
			: slashed ? { year: slashed[3], month: slashed[1], day: slashed[2] }
				: undefined;
	if (!parts) {
		return undefined;
	}
	const month = Number(parts.month);
	const day = Number(parts.day);
	return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { year: parts.year, month: parts.month.padStart(2, '0'), day: parts.day.padStart(2, '0') } : undefined;
}

/** The same day written the ways a tool output may state it. */
function dateForms(date: CalendarDate): readonly string[] {
	const day = String(Number(date.day));
	const month = String(Number(date.month));
	return [
		`${date.year}-${date.month}-${date.day}`,
		`${date.year}${date.month}${date.day}`,
		`${date.day}.${date.month}.${date.year}`,
		`${day}.${month}.${date.year}`,
		`${date.month}/${date.day}/${date.year}`,
		`${month}/${day}/${date.year}`,
	];
}

/**
 * Every date stated in the report body, in order of first appearance and in the form it is written.
 * Link targets and anchors are masked first: their digits identify a document, and a publication
 * number is not a date.
 */
export function extractDates(content: string): readonly string[] {
	const masked = content.replace(IDENTIFIER_SPAN, ' ');
	const seen = new Set<string>();
	const dates: string[] = [];
	for (const match of masked.matchAll(DATE_TOKEN)) {
		const written = match[0];
		if (!parseDate(written) || seen.has(written)) {
			continue;
		}
		seen.add(written);
		dates.push(written);
	}
	return dates;
}

/** Dates traced back to the text a tool returned, and those that were not. */
export interface DateProvenance {
	readonly matched: readonly string[];
	readonly unmatched: readonly string[];
}

/**
 * Look each date up in the text succeeded analytics and status calls returned. A grant, a lapse and
 * an expiry date carry the whole weight of an FTO conclusion, and each is read off a tool output or
 * off nothing at all. A match is evidence the date was read from a recorded output, not that the
 * event it is attached to is the right one.
 */
export function dateProvenance(dates: readonly string[], snapshot: ProvenanceSnapshot): DateProvenance {
	const haystack = returnedText(snapshot);
	const matched: string[] = [];
	const unmatched: string[] = [];
	for (const written of dates) {
		const date = parseDate(written);
		const found = !!date && dateForms(date).some(form => new RegExp(`(?<![\\d])${form.replace(/[./]/g, '\\$&')}(?![\\d])`).test(haystack));
		(found ? matched : unmatched).push(written);
	}
	return { matched, unmatched };
}

/** A quoted span the report attributes to one publication's claims. */
export interface QuotedClaim {
	readonly publication: string;
	readonly quote: string;
}

/** Quotations checked against the claim text the record holds. */
export interface QuotationProvenance {
	readonly matched: readonly QuotedClaim[];
	readonly unmatched: readonly QuotedClaim[];
	/** Publications quoted for their claims whose claim text the record does not hold at all. */
	readonly unrecorded: readonly string[];
}

/** A citation link into a document's claims, with the publication it names. */
const CLAIMS_CITATION = /\b[a-z][\w+.-]*:\/\/[^\s)\]]*[?&]section=claims\b[^\s)\]]*/gi;

/** The publication a citation link names. */
const CITED_PUBLICATION = /[?&]publication=([A-Za-z0-9]+)/;

/** A span between straight or curly double quotes. */
const QUOTED_SPANS = /"([^"]+)"|“([^”]+)”/g;

/** One line of a markdown blockquote. */
const BLOCKQUOTE_LINE = /^[ \t]*>[ \t]?(.+)$/gm;

/** Whitespace and case carry no meaning across a copied quotation; the words do. */
function normalizeQuotation(text: string): string {
	return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Every quotation the report attributes to a publication's claims: a span of at least
 * {@link QUOTATION_LENGTH} characters, between double quotes or on a blockquote line, beginning
 * within {@link QUOTATION_WINDOW} characters after a citation link into that publication's claims.
 *
 * The window is what ties a quotation to a document. A quoted sentence that follows no claims
 * citation is not checked here — it is prose the report never said came from a claim. The window
 * bounds where a quotation starts, not where it ends: a long claim quoted just after its citation
 * is one quotation, not a fragment cut at the three-hundredth character.
 */
export function extractClaimQuotations(content: string): readonly QuotedClaim[] {
	const seen = new Set<string>();
	const quotations: QuotedClaim[] = [];
	for (const citation of content.matchAll(CLAIMS_CITATION)) {
		const publication = CITED_PUBLICATION.exec(citation[0])?.[1];
		if (!publication || citation.index === undefined) {
			continue;
		}
		const start = citation.index + citation[0].length;
		const window = content.slice(start, start + QUOTATION_WINDOW + QUOTATION_TAIL);
		const spans = [...window.matchAll(QUOTED_SPANS), ...window.matchAll(BLOCKQUOTE_LINE)]
			.filter(match => (match.index ?? QUOTATION_WINDOW) < QUOTATION_WINDOW)
			.map(match => match[1] ?? match[2]);
		for (const span of spans) {
			const quote = span.trim();
			const key = publication.toUpperCase() + '\n' + normalizeQuotation(quote);
			if (quote.length < QUOTATION_LENGTH || seen.has(key)) {
				continue;
			}
			seen.add(key);
			quotations.push({ publication, quote });
		}
	}
	return quotations;
}

/**
 * Check each quoted claim span against the claim text recorded for the publication it is cited to.
 * A memo's blocking-claim quotation is the sentence its whole infringement reading rests on; a
 * quotation that is not in the retrieved claim text was written from somewhere else.
 *
 * Comparison ignores case and line breaks only. A quotation that paraphrases, translates, or elides
 * with an ellipsis will not match, and is disclosed as unchecked rather than called wrong.
 */
export function quotationProvenance(quotations: readonly QuotedClaim[], snapshot: ProvenanceSnapshot): QuotationProvenance {
	const claims = new Map<string, string>();
	for (const execution of snapshot.executions) {
		if (execution.kind !== 'details' || execution.status !== 'succeeded') {
			continue;
		}
		for (const source of execution.sources ?? []) {
			if (source.reference.section !== 'claims' || !source.text) {
				continue;
			}
			const key = source.reference.publicationNumber.toUpperCase();
			claims.set(key, (claims.get(key) ?? '') + '\n' + normalizeQuotation(source.text));
		}
	}
	const matched: QuotedClaim[] = [];
	const unmatched: QuotedClaim[] = [];
	const unrecorded = new Set<string>();
	for (const quotation of quotations) {
		const recorded = claims.get(quotation.publication.toUpperCase());
		if (!recorded) {
			unrecorded.add(quotation.publication);
			unmatched.push(quotation);
		} else if (recorded.includes(normalizeQuotation(quotation.quote))) {
			matched.push(quotation);
		} else {
			unmatched.push(quotation);
		}
	}
	return { matched, unmatched, unrecorded: [...unrecorded] };
}

/** `N dates checked …`, the sentence the report states. */
export function dateSentence(provenance: DateProvenance): string {
	const total = provenance.matched.length + provenance.unmatched.length;
	if (total === 0) {
		return 'No date was found in the report body; nothing was checked against recorded tool outputs.';
	}
	const missing = provenance.unmatched.length
		? `${provenance.unmatched.length} not found: ${provenance.unmatched.slice(0, LISTED_DATES).join(', ')}${provenance.unmatched.length > LISTED_DATES ? `, and ${provenance.unmatched.length - LISTED_DATES} more` : ''}`
		: '0 not found';
	return `${total} dates checked against recorded tool outputs; ${provenance.matched.length} found, ${missing}.`;
}

/** A quotation as the provenance section names it: its publication and its opening words. */
function quotationExcerpt(quotation: QuotedClaim): string {
	const quote = quotation.quote.replace(/\s+/g, ' ').trim();
	return `${quotation.publication}: "${quote.slice(0, QUOTATION_EXCERPT)}${quote.length > QUOTATION_EXCERPT ? '…' : ''}"`;
}

/** `N claim quotations checked …`, the sentence the report states. */
export function quotationSentence(provenance: QuotationProvenance): string {
	const total = provenance.matched.length + provenance.unmatched.length;
	if (total === 0) {
		return `No quotation of ${QUOTATION_LENGTH} characters or more follows a claims citation in this report; nothing was compared with recorded claim text.`;
	}
	const missing = provenance.unmatched.length
		? `${provenance.unmatched.length} not found: ${provenance.unmatched.slice(0, LISTED_QUOTATIONS).map(quotationExcerpt).join('; ')}${provenance.unmatched.length > LISTED_QUOTATIONS ? `; and ${provenance.unmatched.length - LISTED_QUOTATIONS} more` : ''}`
		: '0 not found';
	return `${total} claim quotations checked against recorded claim text; ${provenance.matched.length} found verbatim, ${missing}.`;
}

/** The tool identity a record carries, or the one its kind implies. */
function executionLabel(execution: ProvenanceExecution): string {
	return execution.tool ?? (execution.kind === 'search' ? 'search_patents' : execution.kind === 'details' ? 'get_patent_details' : 'unknown tool');
}

/** What the call asked for: its request, its query, or the document it is about. */
function executionRequest(execution: ProvenanceExecution): string {
	return (execution.request ?? execution.query ?? execution.publicationIds?.[0] ?? 'request not recorded').slice(0, REQUEST_LENGTH);
}

/** What the call returned, in the units the record holds. */
function executionCounts(execution: ProvenanceExecution): string {
	if (typeof execution.rowCount === 'number') {
		return `${execution.rowCount} rows`;
	}
	if (typeof execution.total === 'number' || typeof execution.returned === 'number') {
		return `${execution.total ?? 'unknown'} total, ${execution.returned ?? 'unknown'} returned`;
	}
	return 'count not recorded';
}

/** Every recorded call behind the report, as one line each. */
function dataProvenanceLines(snapshot: ProvenanceSnapshot): readonly string[] {
	const recorded = snapshot.executions.filter(execution => ['search', 'details', 'analytics', 'status'].includes(execution.kind));
	if (!recorded.length) {
		return ['No search, document, analytics or legal-status outcome was recorded for this session, so nothing in this report rests on a recorded retrieval.'];
	}
	return recorded.map(execution => `- ${executionLabel(execution)} — ${executionRequest(execution)} — ${executionCounts(execution)} — ${execution.status}`);
}

/** The sentence that says what a generated provenance section is, and what it is not. */
const GENERATED_NOTE = 'Generated from this session\'s execution record, not supplied by the model.';

/**
 * The generated sections appended to a freedom-to-operate memorandum. An FTO conclusion rests on
 * three kinds of statement the model cannot check itself: the figures and dates it read off a status
 * or analytics output, the claim language it quoted, and the calls those came from. Each section
 * states what was traced and what was not; none of them rejects a save.
 */
export function renderFtoAppendix(content: string, snapshot: ProvenanceSnapshot): string {
	const figures = figureProvenance(extractFigures(content), snapshot, content);
	const dates = dateProvenance(extractDates(content), snapshot);
	const quotations = quotationProvenance(extractClaimQuotations(content), snapshot);
	return [
		'## Figure and date provenance (generated)',
		`${GENERATED_NOTE} A figure or date is "found" when it appears in the text a tool returned; that is not a check of what it means, and one that was not found may still be correct.`,
		figureSentence(figures),
		dateSentence(dates),
		'',
		'## Quotation provenance (generated)',
		`${GENERATED_NOTE} Every quoted span of ${QUOTATION_LENGTH} characters or more that follows a claims citation is compared, ignoring case and line breaks, with the claim text recorded for that publication.`,
		quotationSentence(quotations),
		...(quotations.unrecorded.length ? [`No claim text is recorded for ${quotations.unrecorded.join(', ')}; quotations cited to them were compared with nothing. Retrieve the claims with get_patent_details before relying on the quoted wording.`] : []),
		'',
		'## Data provenance (generated)',
		...dataProvenanceLines(snapshot),
	].join('\n');
}

/**
 * What the model is told about the memo it just saved: the untraced figures, dates and quotations it
 * has to source or correct in a follow-up save. The memo states the same thing; this is what reaches
 * the model while it can still act on it.
 */
export function ftoProvenanceResult(content: string, snapshot: ProvenanceSnapshot): string {
	const figures = figureProvenance(extractFigures(content), snapshot, content);
	const dates = dateProvenance(extractDates(content), snapshot);
	const quotations = quotationProvenance(extractClaimQuotations(content), snapshot);
	const untraced = figures.unmatched.length + dates.unmatched.length + quotations.unmatched.length;
	return `\nFTO provenance: ${figureSentence(figures)} ${dateSentence(dates)} ${quotationSentence(quotations)}`
		+ (untraced ? ' Source each figure, date and quotation that was not found in a follow-up save, or replace it with one a recorded output supports.' : '')
		+ ' The memo lists them in its generated provenance sections.';
}
