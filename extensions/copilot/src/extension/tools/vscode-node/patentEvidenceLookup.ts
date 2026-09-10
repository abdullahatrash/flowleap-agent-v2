/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PatentExecutionSnapshot } from '../../patentai/vscode-node/patentExecutionLedger';
import { patentCitationLink } from '../../patentai/vscode-node/patentCitationLink';

export interface PatentEvidenceLookup {
	readonly anchor?: string;
	readonly query?: string;
	/** One-based line in the stored source, or result offset when listing matching lines. */
	readonly start?: number;
}

/** Recover identities and exact returned text locally. This is not a new search or a declaration of review. */
export function lookupPatentEvidence(snapshot: PatentExecutionSnapshot, publication: string, lookup: PatentEvidenceLookup): string {
	const sources = new Map(snapshot.executions.flatMap(execution => execution.sources ?? [])
		.filter(source => source.reference.publicationNumber === publication).map(source => [source.anchor, source]));
	const start = lookup.start ?? 1;
	if (!Number.isInteger(start) || start < 1) { return 'Evidence lookup start must be a positive integer.'; }
	const selected = lookup.anchor ? [...sources.values()].filter(source => source.anchor === lookup.anchor) : [...sources.values()];
	if (!selected.length) { return `No recorded source matches ${lookup.anchor ?? publication}. ${snapshot.limitation}`; }
	if (!lookup.anchor && !lookup.query) {
		return ['Local evidence index. Use evidenceLookup.anchor for paginated text or evidenceLookup.query for a literal search across all stored passages; start defaults to 1. No backend calls were made.',
			...selected.map(source => `${source.anchor} — ${source.text === undefined ? 'text unavailable in this older record' : `${source.text.split(/\r?\n/).length} lines`} — ${patentCitationLink('Open source', source.reference)}`)].join('\n');
	}
	const rows = selected.flatMap(source => (source.text?.split(/\r?\n/) ?? []).map((text, index) => ({ source, text, line: index + 1 })));
	const matching = lookup.query ? rows.filter(row => row.text.toLocaleLowerCase().includes(lookup.query!.toLocaleLowerCase())) : rows;
	const page = matching.slice(start - 1, start - 1 + 30);
	return [`Local returned-text ${lookup.query ? 'literal matches' : 'lines'} ${page.length ? start : 0}–${start - 1 + page.length} of ${matching.length}. ${start - 1 + page.length < matching.length ? `Continue with evidenceLookup.start=${start + page.length}.` : 'End of results.'} Retrieval is not proof of review or completeness; no match does not establish absence from the publication.`,
		...page.map(row => `[${row.source.anchor}; line ${row.line}] ${row.text}`),
		...selected.filter(source => source.text === undefined).map(source => `${source.anchor}: text unavailable in this older record; read the original offloaded result. The anchor is still usable.`)].join('\n');
}
