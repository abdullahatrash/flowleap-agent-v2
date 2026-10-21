/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A result set this large names a technology area, not an invention; reading its pages finds nothing close. */
const BROAD_SET_THRESHOLD = 1000;
/** Below this count the right move is to read, not to widen: a widened query hides what these few hits show. */
const NARROW_SET_THRESHOLD = 10;
/** The most documents OPS serves per `range` call. */
const OPS_PAGE_LIMIT = 100;

/** The page of a result set OPS served, as `search_patents` echoes it in `range`. */
export interface SearchResultPage {
	readonly begin: number;
	readonly end: number;
}

/**
 * The next step a `search_patents` result tells the model, computed from the count OPS returned
 * and the page it served. The method (extract terms, probe, refine, read the set) lives in the
 * patent-search skill; the numbers and the OPS facts that decide the step live here, next to the
 * tool that produced them.
 */
export function searchCountHint(total: number, page?: SearchResultPage): string | undefined {
	if (total > BROAD_SET_THRESHOLD) {
		return `Next step: ${total} hits is a technology area, not an invention. Add the next discriminating term from your extraction list and probe again; do not read pages of this set.`;
	}
	if (total === 0) {
		return 'Next step: 0 hits. A zero count is usually the vocabulary or the field, not absence: check each field name against the query field list, then widen one feature at a time (OR a synonym with the field repeated, or drop the least certain term) and probe again.';
	}
	if (total < NARROW_SET_THRESHOLD) {
		const hits = total === 1 ? '1 hit. Read it' : `${total} hits. Read them`;
		return `Next step: ${hits} before you widen; widen only for a feature that stays unresolved (OR a synonym with the field repeated, drop the classification, or use its parent class).`;
	}
	if (page && total > page.end) {
		return `Next step: ${total} hits, ${page.begin}-${page.end} shown. OPS orders by its default order (newest first), not by relevance, and lists one publication per family. To rely on this set, page range through ${page.end + 1}-${total} (${OPS_PAGE_LIMIT} per call), or narrow until one page holds it.`;
	}
	return undefined;
}

/** OPS fault codes a CQL query can trigger, each with the edit that clears it. Live-checked against OPS on 2026-10-19 where noted. */
const OPS_FAULT_FIXES: ReadonlyMap<string, string> = new Map([
	['CLIENT.MinimumCharsBeforeTruncation', 'a * wildcard needs at least 3 characters before it'],
	['CLIENT.TruncationForbidden', 'this field takes no * wildcard; remove it'],
	['CLIENT.MaximumTotalTerms', 'too many terms; cut the query to its discriminating terms'],
	['CLIENT.InvalidQuery', 'the query is not valid CQL; check the field names and the quoting'],
	['SERVER.DomainAccess', 'a field in the query is not a CQL index'],
]);

/**
 * The grammar fix for an OPS fault carried in a backend error message, or an empty string when the
 * message carries no OPS fault. OPS answers a bad query with an XML fault whose `<code>` names the
 * rule; the model cannot read that XML as a next step, so the tool says it in words.
 */
export function opsFaultHint(message: string): string {
	const code = message.match(/<code>(?<code>[A-Z]+\.[A-Za-z]+)<\/code>/)?.groups?.code;
	if (!code) {
		return '';
	}
	const fix = OPS_FAULT_FIXES.get(code) ?? 'OPS rejected the query grammar';
	return ` OPS fault ${code}: ${fix}. This is a grammar error, not an empty result: fix the query and run it once; call get_search_syntax for the field list.`;
}
