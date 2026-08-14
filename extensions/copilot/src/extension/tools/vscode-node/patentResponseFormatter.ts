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
const TRUNCATION_NOTE_RESERVE = 800;

/**
 * The structured note attached, inside the JSON, to any response that had items dropped. Kept as a
 * plain object so the overall output remains valid, parseable JSON.
 */
interface ITruncationNote {
	readonly truncated: true;
	/** Number of whole array items dropped to fit the budget. */
	readonly omittedItems: number;
	/**
	 * Number of items still present in the arrays items were dropped from — i.e. how much of the
	 * payload the reader actually received. Omitted when nothing was dropped, because then no array
	 * is missing anything and a count would be meaningless. A `0` here means the response carries no
	 * data at all; see {@link emptiedByTruncationNotice}.
	 */
	readonly retainedItems?: number;
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
	 * When true, the value is a single-record document lookup (a by-number claims/description/grant fetch,
	 * however it was routed) rather than a multi-record search result. The sole record is never dropped —
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
 * Builds the notice for the one truncation outcome that is not a truncation at all: EVERY item was
 * dropped, so the response carries no data.
 *
 * This shape reads like a success — a nonzero `count`/`total` survives next to an emptied array, and
 * a size-framed note ("response exceeded the budget", "items omitted") describes only WHY the payload
 * is gone, never that it IS gone. A reader who has just asked for one document sees "too large" and
 * concludes it holds the document and merely needs to offload it, which is the opposite of the truth.
 * So the emptied case leads with what was received rather than with what happened, names the sibling
 * count as untrustworthy, and closes the "too large therefore saved somewhere" inference explicitly.
 */
export function emptiedByTruncationNotice(omittedItems: number, budget: number): string {
	return `NO RECORDS WERE RETURNED — you have not read this record. 0 of ${omittedItems} matching record(s) are present: ` +
		`every item was dropped in transit because the response exceeded this tool's ${budget}-character budget, ` +
		`so the record's content does not appear anywhere below. Any count or total field in this result reports what the ` +
		`SERVER matched, not what you received. "Too large" does not mean "retrieved and offloaded": nothing was saved and ` +
		`no file was written. Do not quote, summarize, describe or save this record's content on the strength of this result. ` +
		`To obtain it, request less of it (fewer fields, a narrower slice) or retrieve it by another route.`;
}

/**
 * A `patent_api_request` call, as far as the single-record classifier needs to see it.
 */
export interface IPatentRequestShape {
	/** Relative backend path including any query string — e.g. `/tools/get_claims`. */
	readonly path: string;
	/** Parsed JSON body of a POST request; `undefined` for a GET. */
	readonly body?: unknown;
}

/**
 * True when a request/response pair is a single-record document lookup — a by-number fetch whose answer
 * is one document. Such responses must never have their sole record dropped to fit the budget (see
 * {@link formatJsonForModel}'s single-record handling): dropping it returns nothing, while keeping it
 * returns everything by way of the harness's file offload.
 *
 * Two tiers, because a path alone cannot see every by-number lookup:
 * - the **tool** tier ({@link isSingleRecordDocumentTool}) recognises tools that return one document by
 *   construction, and fires on the path alone;
 * - the **structural** tier fires when the request names one document ({@link isByNumberRequest} — a
 *   `patent_number`-style identifier or a `patentNumber:`-style query) *and* the payload in fact carries
 *   exactly one record ({@link holdsExactlyOneRecord}). This is the tier that catches
 *   `POST /tools/search_patents` with a by-number query, whose sole oversized record would otherwise be
 *   dropped on the multi-record path.
 *
 * Requests that do NOT name a document — a topical search, a CQL landscape query — stay on the multi-record
 * path even when they happen to match a single hit. Offloading their one hit would be readable, but the
 * single-record note asserts two things that are only true of a by-number lookup ("this by-number document
 * lookup", "do not refine the query"), and refining IS available to a search. What remains there is
 * covered by {@link emptiedByTruncationNotice}, which is the honest answer for that case.
 */
export function isSingleRecordDocumentLookup(request: IPatentRequestShape, payload?: unknown): boolean {
	return isSingleRecordDocumentTool(request.path) || (isByNumberRequest(request) && holdsExactlyOneRecord(payload));
}

/**
 * Names of facade tools that answer with exactly ONE document, so the classification needs no payload.
 *
 * Multi-record tools are deliberately absent: the search tools, and the by-number LIST tools
 * (`get_application_documents`, `get_transactions`, …) whose budget-driven item-dropping — and the
 * "refine your query" note — is unaffected.
 */
const SINGLE_RECORD_TOOLS = new Set([
	'get_claims',
	'get_description',
	'get_bibliography',
	'get_abstract',
	'get_fulltext',
	'get_patent_summary',
	'get_us_grant',
	'get_us_application',
	'read_application_document',
]);

/** True when `path` invokes one of {@link SINGLE_RECORD_TOOLS} on the `/v1/tools` facade. */
function isSingleRecordDocumentTool(path: string): boolean {
	const match = /\/tools\/([A-Za-z0-9_]+)/.exec(path);
	return match !== null && SINGLE_RECORD_TOOLS.has(match[1]);
}

/**
 * Request keys whose value names ONE document. Both spellings are live: facade tool inputs are
 * snake_case (`patent_number`), while the query strings inside them keep the provider's own camelCase.
 */
const BY_NUMBER_KEY = /^(doc|documentNumber|patentNumber|grantNumber|publicationNumber|applicationNumber|applicationNumberText|patentApplicationNumber|patent_number|application_number|cited_document|document_id)$/i;

/** Keys whose value is a query STRING (USPTO ODP Lucene, EPO CQL) rather than a bare identifier. */
const QUERY_STRING_KEY = /^(q|query|cql|criteria|searchText)$/i;

/**
 * Query-language fields that pin a document number inside a search string: ODP Lucene `patentNumber:10958080`
 * and OPS CQL `pn=US10958080`, `num=`, `ap=` (application number). A wildcard form matching many documents is
 * harmless here — the structural tier still requires the payload to carry exactly one record.
 */
const BY_NUMBER_QUERY_FIELD = /\b(patentNumber|publicationNumber|applicationNumber|applicationNumberText|patentApplicationNumber|documentNumber|pn|num|ap)\s*[:=]\s*\S/i;

/**
 * True when the request names one specific document, in the query string (`?doc=EP1234566`) or, as the
 * facade always does, in the POST body (`{ "patent_number": "EP1234566" }`,
 * `{ "query": "pn=US10958080" }`).
 */
function isByNumberRequest(request: IPatentRequestShape): boolean {
	const queryStart = request.path.indexOf('?');
	if (queryStart >= 0) {
		for (const pair of request.path.substring(queryStart + 1).split('&')) {
			const separator = pair.indexOf('=');
			if (separator > 0 && namesOneDocument(pair.substring(0, separator), decodeQueryValue(pair.substring(separator + 1)))) {
				return true;
			}
		}
	}
	return bodyNamesOneDocument(request.body, 0);
}

/** True when a single `key=value` pair identifies one document. */
function namesOneDocument(key: string, value: string): boolean {
	if (value.trim().length === 0) {
		return false;
	}
	return BY_NUMBER_KEY.test(key) || (QUERY_STRING_KEY.test(key) && BY_NUMBER_QUERY_FIELD.test(value));
}

/** Percent-decodes a query-string value, falling back to the raw text when it is not valid encoding. */
function decodeQueryValue(value: string): string {
	try {
		return decodeURIComponent(value.replace(/\+/g, ' '));
	} catch {
		return value;
	}
}

/**
 * True when a parsed POST body names one document. Walks a few levels because backends nest the query
 * (`{ "query": { "q": … } }`); the depth cap keeps a large body from being traversed in full.
 */
function bodyNamesOneDocument(node: unknown, depth: number): boolean {
	if (depth > 3 || node === null || typeof node !== 'object') {
		return false;
	}
	if (Array.isArray(node)) {
		return node.some(item => bodyNamesOneDocument(item, depth + 1));
	}
	for (const [key, value] of Object.entries(node)) {
		if (typeof value === 'string' || typeof value === 'number') {
			if (namesOneDocument(key, String(value))) {
				return true;
			}
		} else if (bodyNamesOneDocument(value, depth + 1)) {
			return true;
		}
	}
	return false;
}

/**
 * True when the payload carries exactly one record: its top-level data array (the largest array-valued
 * property, or the payload itself when it is an array) holds a single item — or there is no top-level
 * array at all, which is how the OPS routes return one document as a nested object.
 *
 * Deliberately top-level: a USPTO file wrapper is one record whose own nested arrays (the document bag)
 * may be far larger, and it is the top-level array that says how many records came back.
 */
function holdsExactlyOneRecord(payload: unknown): boolean {
	if (Array.isArray(payload)) {
		return payload.length === 1;
	}
	if (payload === null || typeof payload !== 'object') {
		return false;
	}
	let dataArray: unknown[] | undefined;
	let dataArraySize = 0;
	for (const value of Object.values(payload)) {
		if (Array.isArray(value)) {
			const size = JSON.stringify(value).length;
			if (size > dataArraySize) {
				dataArraySize = size;
				dataArray = value;
			}
		}
	}
	return dataArray ? dataArray.length === 1 : true;
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
 * When dropping empties the payload completely the note says so in those words rather than reporting a
 * size overrun — see {@link emptiedByTruncationNotice} for why that distinction is load-bearing.
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
	const { omitted: omittedItems, retained: retainedItems } = dropArrayItemsToFit(clone, target);
	// Dropping everything leaves a response that still LOOKS like a result — a surviving count beside an
	// emptied array — so it gets a notice that states the emptiness instead of merely explaining the size.
	const note: ITruncationNote = omittedItems > 0
		? {
			truncated: true,
			omittedItems,
			retainedItems,
			note: retainedItems === 0 ? emptiedByTruncationNotice(omittedItems, budget) : truncationNotice(omittedItems, budget),
		}
		: { truncated: true, omittedItems, note: truncationNotice(omittedItems, budget) };
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
 * structure fits `target` characters. Mutates `node` in place.
 *
 * Returns both how many items were dropped and how many are still there across the arrays that were
 * cut — the caller needs the second number to tell a shortened response from an emptied one.
 */
function dropArrayItemsToFit(node: unknown, target: number): { omitted: number; retained: number } {
	let omitted = 0;
	const cutArrays = new Set<unknown[]>();
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
		cutArrays.add(largest);
		omitted += dropCount;
	}
	let retained = 0;
	for (const cut of cutArrays) {
		retained += cut.length;
	}
	return { omitted, retained };
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
