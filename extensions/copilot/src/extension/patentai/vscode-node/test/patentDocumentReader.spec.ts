/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { parsePatentDocumentReference, PatentDocumentReference } from '../../common/patentDocumentReference';
import { PatentReaderData, renderPatentDocument } from '../patentDocumentHtml';
import { addPatentReaderLinks, patentCitationLink } from '../patentCitationLink';

vi.mock('vscode', () => ({ env: { uriScheme: 'flowleap' } }));

const reference: PatentDocumentReference = { publicationNumber: 'EP1000000A1', section: 'claims', claimNumber: '2' };
const data: PatentReaderData = {
	title: '<script>untrusted()</script>', applicants: ['Applicant'], publicationDate: '20000517',
	abstract: 'An abstract.', claims: [{ number: '1', text: 'First claim.' }, { number: '2', text: '<img src=x onerror=untrusted()>Second claim.' }],
	description: 'Description.', loadedAt: '2026-09-05 08:00',
};

describe('patent document reader', () => {
	it('enriches nested API records without changing retrieved text or adding links for null references', () => {
		const input = { data: { claims: [{ text: 'Claim text.', documentReference: reference }, { text: 'NPL', documentReference: null }] } };
		expect(addPatentReaderLinks(input)).toEqual({ data: { claims: [
			{ ...input.data.claims[0], readerLink: patentCitationLink('EP1000000A1, claim 2', reference) }, input.data.claims[1],
		] } });
		expect(input.data.claims[0]).not.toHaveProperty('readerLink');
	});
	it('carries a backend claim reference through Markdown into a reader URI', () => {
		const markdown = patentCitationLink('EP1000000A1, claim 2', reference);
		expect(markdown).toBe('[EP1000000A1, claim 2](flowleap://flowleap.patent-ai/patent?publication=EP1000000A1&section=claims&claim=2)');
		const uri = new URL(markdown.slice(markdown.indexOf('](') + 2, -1));
		expect(parsePatentDocumentReference({ publicationNumber: uri.searchParams.get('publication'), section: uri.searchParams.get('section'), claimNumber: uri.searchParams.get('claim') })).toEqual(reference);
	});

	it('rejects malformed navigation input and leaves unresolved citations as text', () => {
		expect([
			parsePatentDocumentReference({ ...reference, publicationNumber: 'https://example.com' }),
			parsePatentDocumentReference({ ...reference, publicationNumber: '16123456' }),
			parsePatentDocumentReference({ ...reference, claimNumber: '2</script>' }),
			parsePatentDocumentReference({ ...reference, section: 'description' }),
		]).toEqual([undefined, undefined, undefined, undefined]);
		expect(patentCitationLink('Unresolved reference', null)).toBe('Unresolved reference');
	});

	it('escapes retrieved content and highlights the actual requested claim', () => {
		const html = renderPatentDocument(reference, 'test-nonce', data);
		expect(html).toContain('id="claim-2" tabindex="-1" class="claim selected"');
		expect(html).toContain('&lt;script&gt;untrusted()&lt;/script&gt;');
		expect(html).toContain('&lt;img src=x onerror=untrusted()&gt;');
		expect(html).not.toContain('<script>untrusted()');
		expect(html).toContain("default-src 'none'");
		expect(html).toContain('fresh document lookup');
	});

	it('reports a missing claim instead of highlighting an unrelated passage', () => {
		const html = renderPatentDocument({ ...reference, claimNumber: '9' }, 'test-nonce', data);
		expect(html).toContain('Claim 9 was not returned');
		expect(html).not.toContain('class="claim selected"');
	});
});
