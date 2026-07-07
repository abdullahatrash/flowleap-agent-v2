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
 * tools. Values are the maximum number of characters a formatted response may contain before
 * {@link formatJsonForModel} starts dropping array items to fit.
 */
export const ToolResponseBudgets = {
	/** `patent_api_request`: raw backend JSON passed straight through to the model. */
	PatentApiRequest: 50_000,
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
	/** True when array items were dropped to fit the budget. */
	readonly truncated: boolean;
	/** Number of whole array items dropped; 0 when nothing was truncated. */
	readonly omittedItems: number;
}

/**
 * Builds the uniform truncation notice appended (inside the JSON) to any truncated response. The
 * wording is deliberately shared so every tool nudges the model the same way.
 */
export function truncationNotice(omittedItems: number, budget: number): string {
	return `Response exceeded this tool's ${budget}-character budget. ${omittedItems} result item(s) were omitted to keep the output valid JSON. ` +
		`Refine your query — add filters, narrow the date range, or request fewer results — to retrieve the omitted items.`;
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
 */
export function formatJsonForModel(value: unknown, budget: number): IFormattedJsonResponse {
	const pretty = JSON.stringify(value, null, 2);
	if (pretty.length <= budget) {
		return { content: pretty, truncated: false, omittedItems: 0 };
	}

	const clone: unknown = structuredClone(value);
	const target = Math.max(0, budget - TRUNCATION_NOTE_RESERVE);
	const omittedItems = dropArrayItemsToFit(clone, target);
	const note: ITruncationNote = { truncated: true, omittedItems, note: truncationNotice(omittedItems, budget) };

	let annotated: unknown;
	if (Array.isArray(clone)) {
		clone.push({ [TRUNCATION_KEY]: note });
		annotated = clone;
	} else if (clone !== null && typeof clone === 'object') {
		(clone as Record<string, unknown>)[TRUNCATION_KEY] = note;
		annotated = clone;
	} else {
		annotated = { result: clone, [TRUNCATION_KEY]: note };
	}

	return { content: JSON.stringify(annotated, null, 2), truncated: true, omittedItems };
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
