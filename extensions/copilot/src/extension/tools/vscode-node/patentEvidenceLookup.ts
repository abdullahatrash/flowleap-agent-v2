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
	/** Zero-based UTF-16 offset within the first returned text line; use the supplied continuation. */
	readonly offset?: number;
}

const pageRows = 30;
const pageCharacters = 8000;

function continuation(lookup: PatentEvidenceLookup): string {
	return `Continue with evidenceLookup=${JSON.stringify(lookup)}. Keep the same publicationNumber. Join continued parts of the same source line without adding whitespace.`;
}

/** Recover identities and exact returned text locally. This is not a new search or a declaration of review. */
export function lookupPatentEvidence(snapshot: PatentExecutionSnapshot, publication: string, lookup: PatentEvidenceLookup): string {
	const sources = new Map(snapshot.executions.flatMap(execution => execution.sources ?? [])
		.filter(source => source.reference.publicationNumber === publication).map(source => [source.anchor, source]));
	const start = lookup.start ?? 1;
	if (!Number.isInteger(start) || start < 1) { return 'Evidence lookup start must be a positive integer.'; }
	const offset = lookup.offset ?? 0;
	if (!Number.isInteger(offset) || offset < 0) { return 'Evidence lookup offset must be a non-negative integer.'; }
	const selected = lookup.anchor ? [...sources.values()].filter(source => source.anchor === lookup.anchor) : [...sources.values()];
	if (!selected.length) { return `No recorded source matches ${lookup.anchor ?? publication}. Discover exact anchors with get_patent_details(publicationNumber: "${publication}", evidenceLookup: {}). Do not guess an anchor or search the source text for an anchor ID. ${snapshot.limitation}`; }
	if (!lookup.anchor && !lookup.query) {
		if (offset) { return 'Evidence index uses start only; offset applies to source text.'; }
		const page = selected.slice(start - 1, start - 1 + pageRows);
		const details = [...snapshot.executions].reverse().find(execution => execution.kind === 'details' && execution.status === 'succeeded' && execution.sources?.some(source => source.reference.publicationNumber === publication));
		const title = details?.publicationTitle;
		const metadata = `Recorded publication: ${publication}. Publication date: ${details?.publicationDate ?? 'not recorded'}. Title: ${title ? title.slice(0, 500) + (title.length > 500 ? '… (shortened)' : '') : 'not recorded'}.`;
		return [`Local evidence index: ${selected.length} sources. Use evidenceLookup.anchor for paginated text or evidenceLookup.query for a literal search across all stored passages. No backend calls were made.`,
			metadata,
			...page.map(source => `${source.anchor} — ${source.text === undefined ? 'text unavailable in this older record' : `${source.text.split(/\r?\n/).length} lines`} — ${patentCitationLink('Open source', source.reference)}`),
			start - 1 + page.length < selected.length ? continuation({ start: start + page.length }) : 'End of index.'].join('\n');
	}
	const rows = selected.flatMap(source => (source.text?.split(/\r?\n/) ?? []).map((text, index) => ({ source, text, line: index + 1 })));
	const matching = lookup.query ? rows.filter(row => row.text.toLocaleLowerCase().includes(lookup.query!.toLocaleLowerCase())) : rows;
	if (offset && (!matching[start - 1] || offset >= matching[start - 1].text.length)) { return 'Evidence lookup offset is outside the selected line. Use the supplied continuation or omit offset to read from its beginning.'; }
	const page: string[] = [];
	let position = start - 1;
	let character = offset;
	let remaining = pageCharacters;
	while (position < matching.length && page.length < pageRows && remaining > 0) {
		const row = matching[position];
		// Blank source lines retain their positions but do not consume the useful-row allowance.
		if (!row.text.trim()) { position++; character = 0; continue; }
		const prefix = `[${row.source.anchor}; line ${row.line}${character ? `; offset ${character}` : ''}] `;
		if (remaining <= prefix.length + 1) { break; }
		let end = Math.min(row.text.length, character + remaining - prefix.length);
		// Do not split a Unicode surrogate pair between pages.
		if (end < row.text.length && /[\uD800-\uDBFF]/.test(row.text[end - 1])) { end--; }
		const text = prefix + row.text.slice(character, end);
		page.push(text);
		remaining -= text.length + 1;
		if (end < row.text.length) { character = end; break; }
		position++;
		character = 0;
	}
	while (position < matching.length && !matching[position].text.trim()) { position++; character = 0; }
	return [`Local returned-text ${lookup.query ? 'literal matches' : 'lines'}: ${matching.length} results, starting at ${start}. Retrieval is not proof of review or completeness; no match does not establish absence from the publication.`,
		...page,
		position < matching.length ? continuation({ ...lookup, start: position + 1, offset: character }) : 'End of results.',
		...selected.filter(source => source.text === undefined).map(source => `${source.anchor}: text unavailable in this older record; retrieve this publication once without evidenceLookup to recover stored text.`)].join('\n');
}
