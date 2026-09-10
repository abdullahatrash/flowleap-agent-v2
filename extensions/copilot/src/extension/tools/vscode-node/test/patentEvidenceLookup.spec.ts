/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { PatentEvidenceSource, PatentExecutionSnapshot } from '../../../patentai/vscode-node/patentExecutionLedger';
import { lookupPatentEvidence, PatentEvidenceLookup } from '../patentEvidenceLookup';

vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

const publication = 'EP1000000A1';
const source: PatentEvidenceSource = {
	anchor: `${publication}:description:de`,
	reference: { publicationNumber: publication, section: 'description' },
	language: 'de', text: '', retrieval: 'returned', review: 'unknown', completeness: 'unknown',
};

function snapshot(sources: PatentEvidenceSource[]): PatentExecutionSnapshot {
	return { executions: [{ id: 'retrieval', recordedAt: '2026-09-10', kind: 'details', status: 'succeeded', sources }], limitation: 'Returned evidence only.' };
}

function nextLookup(result: string): PatentEvidenceLookup | undefined {
	const match = /Continue with evidenceLookup=(?<lookup>\{[^\n]+\})\. Keep/.exec(result);
	return match?.groups ? JSON.parse(match.groups.lookup) : undefined;
}

describe('bounded local patent evidence inspection', () => {
	it('uses the useful-row budget for source text while preserving original line numbers', () => {
		const text = Array.from({ length: 60 }, (_, i) => i % 2 ? '' : `Passage ${i + 1}`).join('\n');
		const result = lookupPatentEvidence(snapshot([{ ...source, text }]), publication, { anchor: source.anchor });
		expect({ lastUsefulLine: result.includes('; line 59] Passage 59'), continuation: nextLookup(result) }).toEqual({ lastUsefulLine: true, continuation: undefined });
	});
	it('provides a valid recovery route for a guessed anchor instead of inviting another text search', () => {
		const result = lookupPatentEvidence(snapshot([{ ...source, text: 'A source.' }]), publication, { anchor: 'claims' });
		expect(result).toContain('evidenceLookup: {}');
		expect(result).toContain('Do not guess an anchor');
	});
	it('exposes recorded publication metadata in the local index without reading the offload', () => {
		const state = snapshot([{ ...source, text: 'Returned description.' }]);
		const withMetadata = { ...state, executions: [{ ...state.executions[0], publicationTitle: 'Dental restorative composition', publicationDate: '2000-03-08' }] };
		const index = lookupPatentEvidence(withMetadata, publication, {});
		expect({ publication: index.includes(`Recorded publication: ${publication}`), date: index.includes('Publication date: 2000-03-08'), title: index.includes('Dental restorative composition') }).toEqual({ publication: true, date: true, title: true });
	});

	it('pages a large claims index without repeating the first page', () => {
		const sources = Array.from({ length: 75 }, (_, i) => ({ ...source, anchor: `${publication}:claims:${i + 1}:de`, text: `${i + 1}. Eine Batterie.`, reference: { publicationNumber: publication, section: 'claims' as const, claimNumber: String(i + 1) } }));
		const state = snapshot(sources);
		const pages: string[] = [];
		let request: PatentEvidenceLookup | undefined = {};
		while (request && pages.length < 5) {
			const result = lookupPatentEvidence(state, publication, request);
			pages.push(result);
			request = nextLookup(result);
		}
		const anchors = pages.flatMap(page => page.split('\n').filter(line => line.startsWith(publication)).map(line => line.split(' — ')[0]));
		expect({ anchors, pages: pages.length, next: request }).toEqual({ anchors: sources.map(item => item.anchor), pages: 3, next: undefined });
	});

	it.each([false, true])('recovers complete long source lines across bounded pages (literal search: %s)', useQuery => {
		const text = '[0032] ' + 'Die Batterie enthält einen Separator 🔋 und eine Schutzschaltung. '.repeat(500);
		const state = snapshot([{ ...source, text }]);
		let request: PatentEvidenceLookup | undefined = { anchor: source.anchor, ...(useQuery ? { query: 'Separator' } : {}) };
		const fragments: string[] = [];
		const sizes: number[] = [];
		while (request && sizes.length < 20) {
			const result = lookupPatentEvidence(state, publication, request);
			sizes.push(result.length);
			fragments.push(...result.split('\n').filter(line => line.startsWith(`[${source.anchor};`)).map(line => line.slice(line.indexOf('] ') + 2)));
			request = nextLookup(result);
			if (request) {
				expect({ anchor: request.anchor, query: request.query }).toEqual({ anchor: source.anchor, query: useQuery ? 'Separator' : undefined });
			}
		}
		expect({ complete: fragments.join(''), bounded: sizes.every(size => size < 9000), pages: sizes.length > 1, next: request }).toEqual({ complete: text, bounded: true, pages: true, next: undefined });
		expect(fragments.some(fragment => /[\uD800-\uDBFF]$/.test(fragment) || /^[\uDC00-\uDFFF]/.test(fragment))).toBe(false);
	});

	it('preserves source line numbers and reaches later matching passages', () => {
		const text = Array.from({ length: 120 }, (_, i) => `[${i}] sensor feedback`).join('\n');
		const state = snapshot([{ ...source, text }]);
		const first = lookupPatentEvidence(state, publication, { query: 'feedback', start: 60 });
		const continuation = nextLookup(first);
		expect({ firstLine: first.includes('; line 60] [59] sensor'), continuation }).toEqual({ firstLine: true, continuation: { query: 'feedback', start: 90, offset: 0 } });
		expect(lookupPatentEvidence(state, publication, continuation!).includes('; line 90] [89] sensor')).toBe(true);
	});

	it('uses the latest retrieved text for a repeated anchor and preserves absence uncertainty', () => {
		const state = snapshot([{ ...source, text: 'Old description.' }]);
		const revisedState: PatentExecutionSnapshot = { ...state, executions: [...state.executions, { id: 'second', recordedAt: '2026-09-11', kind: 'details', status: 'succeeded', sources: [{ ...source, text: 'Revised description with sensor feedback.' }] }] };
		const result = lookupPatentEvidence(revisedState, publication, { anchor: source.anchor });
		expect({ old: result.includes('Old description.'), revised: result.includes('Revised description'), absence: lookupPatentEvidence(state, publication, { query: 'nonexistent' }).includes('no match does not establish absence') }).toEqual({ old: false, revised: true, absence: true });
	});

	it('rejects invalid continuation positions instead of repeating or silently truncating text', () => {
		const state = snapshot([{ ...source, text: 'Short line.' }]);
		expect(lookupPatentEvidence(state, publication, { anchor: source.anchor, offset: 100 })).toContain('outside the selected line');
		expect(lookupPatentEvidence(state, publication, { anchor: source.anchor, start: 0 })).toContain('positive integer');
		expect(lookupPatentEvidence(state, publication, { offset: 1 })).toContain('index uses start only');
	});
});
