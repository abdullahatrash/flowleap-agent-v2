/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared, budget-aware response formatter for the patent tools.
 *
 * The patent tools return backend JSON (and, increasingly, list-shaped summaries) straight to the
 * language model. Raw responses can be large, so each tool needs to cap what it hands back without
 * (a) inventing its own magic character count or (b) slicing a pretty-printed JSON blob mid-structure
 * and handing the model unparseable text. This module centralises that concern:
 *
 * - {@link ToolResponseBudgets} — the single named table of per-tool character budgets.
 * - {@link formatJsonForModel} — structure-aware truncation that only ever drops whole array items,
 *   attaches an explicit omitted-count note, and always returns valid, parseable JSON.
 * - {@link renderMarkdownTable} — a rendering primitive for list-shaped results, consumed by the
 *   claim-table / claim-chart follow-up slices.
 *
 * The module is pure (no service dependencies), mirroring `curlToApiRequest.ts`, so it is unit-tested
 * in isolation.
 */

/**
 * Per-tool character budgets for responses handed back to the language model.
 *
 * One named table replaces the magic numbers that were previously scattered across the individual
 * tools. Two kinds of entry live here:
 * - whole-response budgets — the maximum number of characters a formatted response may contain before
 *   {@link formatJsonForModel} starts dropping array items to fit (e.g. {@link ToolResponseBudgets.PatentApiRequest});
 * - per-field preview limits — the maximum number of characters of a single long field (an abstract, a
 *   joined passage list) rendered alongside a markdown table via {@link truncatePreview}.
 */
export const ToolResponseBudgets = {
	/** `patent_api_request`: raw backend JSON passed straight through to the model. */
	PatentApiRequest: 50_000,
	/** `search_patents`: max characters of each result's abstract preview rendered below the results table. */
	SearchPatentsAbstract: 200,
	/** `search_citations`: max characters of the joined cited-passages preview rendered per row below the table. */
	SearchCitationsPassages: 200,
	/** `search_forward_citations`: max characters of the joined cited-passages preview rendered per row below the table. */
	SearchForwardCitationsPassages: 200,
	/** `patent_analytics_viz`: defensive whole-response ceiling for the assembled aggregate tables. */
	PatentAnalyticsViz: 20_000,
	/** `patstat_portfolio`: defensive whole-response ceiling for the assembled portfolio tables. */
	PatstatPortfolio: 20_000,
	/** `patstat_query`: whole-response ceiling for the guarded-SQL result table (5,000-row/5MB caps live server-side; this bounds the rendered markdown). */
	PatstatQuery: 20_000,
	/** `patstat_graph`: whole-response ceiling for a relayed verb `text` or a rendered composite screen. */
	PatstatGraph: 20_000,
	/** `compare_claims`: per-patent cap on the full claim text rendered below the element-by-element chart. */
	CompareClaimsText: 4_000,
} as const;

/** Key inserted into a truncated JSON object/array to carry the omitted-count note. */
const TRUNCATION_KEY = '_truncation';

/** Characters reserved within the budget for the truncation note that gets attached after trimming. */
const TRUNCATION_NOTE_RESERVE = 600;

/**
 * The structured note attached, inside the JSON, to any response that had items dropped. Kept as a
 * plain object so the overall output remains valid, parseable JSON.
 */
interface ITruncationNote {
	readonly truncated: true;
	/** Number of whole array items dropped to fit the budget. */
	readonly omittedItems: number;
	/** Human/model-facing guidance on how to retrieve the omitted items. */
	readonly note: string;
}

/**
 * Result of formatting a value for the model. `content` is always safe to hand to the model; when the
 * source was JSON it is always valid, parseable JSON.
 */
export interface IFormattedJsonResponse {
	/** The formatted body. Valid, parseable JSON. */
	readonly content: string;
	/**
	 * True when the response exceeded the budget and a truncation note was attached — either because
	 * array items were dropped (multi-record) or because a single oversized record was handed back
	 * intact for the harness to offload (single-record).
	 */
	readonly truncated: boolean;
	/** Number of whole array items dropped; 0 when nothing was dropped (including the single-record case). */
	readonly omittedItems: number;
}

/**
 * Options controlling how {@link formatJsonForModel} handles an over-budget response.
 */
export interface IFormatJsonOptions {
	/**
	 * When true, the value is a single-record document lookup (a by-number claims/description/grant fetch)
	 * rather than a multi-record search result. The sole record is never dropped to fit the budget —
	 * the full record is handed back intact so the harness's large-tool-result disk offload writes it to
	 * a file and gives the model a `read_file` pointer, and the attached note carries single-record
	 * guidance instead of the meaningless "refine your query". See {@link isSingleRecordDocumentLookup}.
	 */
	readonly singleRecord?: boolean;
}

/**
 * Builds the truncation notice attached (inside the JSON) to an over-budget response.
 *
 * For a multi-record search result the note reports how many items were dropped and nudges the model to
 * narrow the query. For a single-record document lookup nothing is dropped: the note explains the one
 * record was too large for the inline budget, that the full text is offloaded to a file to be read with
 * the `read_file` tool, and that refining the query is pointless for a by-number lookup.
 */
export function truncationNotice(omittedItems: number, budget: number, singleRecord: boolean = false): string {
	if (singleRecord) {
		return `This by-number document lookup returned a single record larger than this tool's ${budget}-character inline budget. ` +
			`No data was dropped: the full record — including the complete claims/description text — is returned intact and offloaded to a file, ` +
			`so read it with the read_file tool at the path this result reports. ` +
			`Do not refine the query or narrow the date range; a by-number lookup has exactly one matching record.`;
	}
	return `Response exceeded this tool's ${budget}-character budget. ${omittedItems} result item(s) were omitted to keep the output valid JSON. ` +
		`Refine your query — add filters, narrow the date range, or request fewer results — to retrieve the omitted items.`;
}

/**
 * True when `path` is a single-record document lookup — a by-number fetch that returns exactly one
 * document (USPTO `grants/{n}`, OPS full-text `claims`/`description`). Such responses must never have
 * their sole record dropped to fit the budget (see {@link formatJsonForModel}'s single-record handling).
 *
 * Multi-record search endpoints (`…/search`, `…/docs`, CQL queries) are deliberately excluded so their
 * budget-driven item-dropping — and the "refine your query" note that is correct for them — is unaffected.
 */
export function isSingleRecordDocumentLookup(path: string): boolean {
	// USPTO by-number grant fetch: /patent-search-uspto/grants/<number>.
	if (/\/grants\/[^/?]+/.test(path)) {
		return true;
	}
	// OPS single-document full text: /ops/fulltext/claims|description (keyed on ?doc=), or an explicit enrich= form.
	if (/\/fulltext\/(claims|description)\b/.test(path) || /[?&]enrich=(claims|description)\b/.test(path)) {
		return true;
	}
	return false;
}

/**
 * Formats an arbitrary value as pretty-printed JSON, capped at `budget` characters.
 *
 * When the pretty-printed value fits the budget it is returned unchanged. When it does not, whole
 * array items are dropped (largest array first) until it fits, and an explicit {@link ITruncationNote}
 * is attached inside the JSON:
 * - a top-level array gains a final marker element `{ "_truncation": … }`,
 * - a top-level object gains a `"_truncation"` key,
 * - any other top-level value is wrapped as `{ "result": …, "_truncation": … }`.
 *
 * The output is never sliced mid-structure, so it always parses. The budget is best-effort: if a value
 * cannot be brought under budget by dropping array items (e.g. one enormous object with no arrays), the
 * still-valid JSON is returned as-is with the note attached.
 *
 * Single-record document lookups ({@link IFormatJsonOptions.singleRecord}) are handled differently: the
 * sole oversized record is never dropped. It is returned intact — deliberately over the inline budget —
 * so the harness's large-tool-result disk offload (see `toolCalling.tsx`, default on above 8 KB) writes
 * it to a file and hands the model a `read_file` pointer. This reuses the existing offload path rather
 * than dropping the data, and attaches a single-record note in place of the multi-record guidance.
 */
export function formatJsonForModel(value: unknown, budget: number, options?: IFormatJsonOptions): IFormattedJsonResponse {
	const pretty = JSON.stringify(value, null, 2);
	if (pretty.length <= budget) {
		return { content: pretty, truncated: false, omittedItems: 0 };
	}

	// A by-number document lookup returns exactly one record whose own field (claims/description text) is
	// oversized. Dropping it leaves an empty result the model cannot act on, so hand the full record back
	// and let the harness offload it; nothing is omitted.
	if (options?.singleRecord) {
		const note: ITruncationNote = { truncated: true, omittedItems: 0, note: truncationNotice(0, budget, true) };
		const annotated = annotateWithTruncationNote(structuredClone(value), note);
		return { content: JSON.stringify(annotated, null, 2), truncated: true, omittedItems: 0 };
	}

	const clone: unknown = structuredClone(value);
	const target = Math.max(0, budget - TRUNCATION_NOTE_RESERVE);
	const omittedItems = dropArrayItemsToFit(clone, target);
	const note: ITruncationNote = { truncated: true, omittedItems, note: truncationNotice(omittedItems, budget) };
	const annotated = annotateWithTruncationNote(clone, note);

	return { content: JSON.stringify(annotated, null, 2), truncated: true, omittedItems };
}

/**
 * Attaches `note` to a (cloned) value so the overall output stays valid, parseable JSON:
 * - a top-level array gains a final marker element `{ "_truncation": … }`,
 * - a top-level object gains a `"_truncation"` key,
 * - any other top-level value is wrapped as `{ "result": …, "_truncation": … }`.
 * Mutates `clone` in place (for the array/object cases) and returns the value to serialize.
 */
function annotateWithTruncationNote(clone: unknown, note: ITruncationNote): unknown {
	if (Array.isArray(clone)) {
		clone.push({ [TRUNCATION_KEY]: note });
		return clone;
	}
	if (clone !== null && typeof clone === 'object') {
		(clone as Record<string, unknown>)[TRUNCATION_KEY] = note;
		return clone;
	}
	return { result: clone, [TRUNCATION_KEY]: note };
}

/**
 * Repeatedly drops trailing items from the largest array reachable in `node` until the pretty-printed
 * structure fits `target` characters. Mutates `node` in place. Returns the number of items dropped.
 */
function dropArrayItemsToFit(node: unknown, target: number): number {
	let omitted = 0;
	// Guard against pathological inputs; each iteration removes at least one item so this always terminates.
	for (let guard = 0; guard < 1_000_000; guard++) {
		const size = JSON.stringify(node, null, 2).length;
		if (size <= target) {
			break;
		}
		const largest = findLargestArray(node);
		if (!largest || largest.length === 0) {
			break; // nothing left to drop — return best-effort valid JSON
		}
		const over = size - target;
		const perItem = Math.max(1, Math.floor(JSON.stringify(largest, null, 2).length / largest.length));
		const dropCount = Math.min(largest.length, Math.max(1, Math.ceil(over / perItem)));
		largest.splice(largest.length - dropCount, dropCount);
		omitted += dropCount;
	}
	return omitted;
}

/**
 * Traverses `node` and returns the non-empty array reference whose serialized form is largest, or
 * `undefined` when no non-empty array exists.
 */
function findLargestArray(node: unknown): unknown[] | undefined {
	let best: unknown[] | undefined;
	let bestSize = 0;
	const visit = (n: unknown): void => {
		if (Array.isArray(n)) {
			if (n.length > 0) {
				const size = JSON.stringify(n).length;
				if (size > bestSize) {
					bestSize = size;
					best = n;
				}
			}
			for (const item of n) {
				visit(item);
			}
		} else if (n !== null && typeof n === 'object') {
			for (const key of Object.keys(n)) {
				visit((n as Record<string, unknown>)[key]);
			}
		}
	};
	visit(node);
	return best;
}

/**
 * Truncates `text` to at most `maxLength` characters for inline preview, appending an ellipsis when the
 * text was cut. Used for the long free-text fields (abstracts, joined cited passages) that the list
 * tools render alongside a markdown table rather than inside a table cell. The per-tool `maxLength`
 * comes from {@link ToolResponseBudgets}.
 */
export function truncatePreview(text: string, maxLength: number): string {
	return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

/**
 * Column specification for {@link renderMarkdownTable}. `cell` maps a row to its rendered string value
 * for this column.
 */
export interface IMarkdownColumn<T> {
	/** Column header text. */
	readonly header: string;
	/** Renders the cell value for a given row. */
	readonly cell: (row: T) => string;
	/** Column alignment; defaults to left. */
	readonly align?: 'left' | 'right' | 'center';
}

/**
 * Renders `rows` as a GitHub-flavored markdown table using `columns`. Cell and header text has pipes
 * and newlines escaped so a value can never break the table structure. When `rows` is empty a valid
 * header-only table is returned.
 */
export function renderMarkdownTable<T>(rows: readonly T[], columns: readonly IMarkdownColumn<T>[]): string {
	const escape = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
	const headerRow = `| ${columns.map(c => escape(c.header)).join(' | ')} |`;
	const separatorRow = `| ${columns.map(c => alignmentMarker(c.align)).join(' | ')} |`;
	const bodyRows = rows.map(row => `| ${columns.map(c => escape(c.cell(row))).join(' | ')} |`);
	return [headerRow, separatorRow, ...bodyRows].join('\n');
}

/** Maps a column alignment to its markdown separator-row marker. */
function alignmentMarker(align: IMarkdownColumn<unknown>['align']): string {
	switch (align) {
		case 'right': return '---:';
		case 'center': return ':---:';
		default: return '---';
	}
}
