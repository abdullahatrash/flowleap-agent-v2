/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { IPatentBackendClient } from '../patentBackendClient';
import { loadPatentDocument } from '../patentDocumentData';
import { renderPatentDocument } from '../patentDocumentHtml';
import { PatentDocumentReference } from '../../common/patentDocumentReference';

const reference: PatentDocumentReference = { publicationNumber: 'EP1234567B1', section: 'claims', claimNumber: '4' };
const bibliography = { docId: 'EP1234567.B1', title: 'Granted composition', abstract: null, applicants: [], dates: { publication: '20070411' } };
const claims = { docId: 'EP1234567B1', claims: [{ number: '3', text: '3. Composition:\n(a) first\n(b) second\n(c) third' }, { number: '4', text: '4. Composition according to Claim 3.' }] };

function backend(overrides: Record<string, object> = {}) {
	const calls: { path: string; body: unknown }[] = [];
	const responses: Record<string, object> = { get_bibliography: bibliography, get_claims: claims, get_description: { docId: 'EP1234567B1', description: 'Granted description' }, ...overrides };
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl() { return ''; },
		getTrialModelKey(): never { throw new Error('Unused'); },
		get(): never { throw new Error('Unused'); },
		async post<T>(path: string, body: unknown): Promise<T> {
			calls.push({ path, body });
			return { success: true, data: responses[path.replace('/tools/', '')] } as T;
		},
	};
	return { client, calls };
}

describe('patent reader publication retrieval', () => {
	it('preserves B1 through every request and renders complete provider claims at their actual anchors', async () => {
		const { client, calls } = backend();
		const data = await loadPatentDocument(client, reference, CancellationToken.None);
		expect(calls.map(call => call.body)).toEqual(Array(3).fill({ patent_number: 'EP1234567B1' }));
		const html = renderPatentDocument(reference, 'nonce', data);
		expect(html).toContain('20070411');
		expect(html).toContain('3. Composition:\n(a) first\n(b) second\n(c) third');
		expect(html).toContain('id="claim-4" tabindex="-1" class="claim selected"');
		expect(html).not.toContain('id="claim-5"');
	});

	it('rejects kindless citations before retrieving any content', async () => {
		const { client, calls } = backend();
		await expect(loadPatentDocument(client, { ...reference, publicationNumber: 'EP1234567' }, CancellationToken.None)).rejects.toThrow('Specify a publication kind');
		expect(calls).toEqual([]);
	});

	it('rejects an older backend returning A2 bibliography for B1', async () => {
		const { client } = backend({ get_bibliography: { ...bibliography, docId: 'EP1234567.A2', dates: { publication: '20020828' } } });
		await expect(loadPatentDocument(client, reference, CancellationToken.None)).rejects.toThrow('did not return the requested publication EP1234567B1');
	});

	it.each(['EP1234567A2', 'EP1234567', undefined])('surfaces unverified claims (%s) as unavailable while retaining verified bibliography', async docId => {
		const { client } = backend({ get_claims: { ...claims, docId } });
		const data = await loadPatentDocument(client, reference, CancellationToken.None);
		expect(data.claims).toEqual([]);
		expect(data.claimsError).toContain('did not return the requested publication');
		expect(renderPatentDocument(reference, 'nonce', data)).not.toContain('4. Composition according to Claim 3.');
	});

	it('does not mix an A2 description into a B1 reader', async () => {
		const { client } = backend({ get_description: { docId: 'EP1234567A2', description: 'Earlier description' } });
		const data = await loadPatentDocument(client, reference, CancellationToken.None);
		expect(data.description).toBeNull();
		expect(data.descriptionError).toContain('did not return the requested publication');
	});

	it('accepts equivalent US serial formatting while still rejecting a different kind', async () => {
		const usReference = { ...reference, publicationNumber: 'US20260069159A1' };
		const overrides = { get_bibliography: { ...bibliography, docId: 'US20260069159.A1' }, get_claims: { ...claims, docId: 'US-2026069159-A1' } };
		const accepted = await loadPatentDocument(backend(overrides).client, usReference, CancellationToken.None);
		const rejected = await loadPatentDocument(backend({ ...overrides, get_claims: { ...claims, docId: 'US-2026069159-A2' } }).client, usReference, CancellationToken.None);
		expect([accepted.claims.length, rejected.claims.length]).toEqual([2, 0]);
	});
});
