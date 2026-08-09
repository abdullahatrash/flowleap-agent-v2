/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { endpointSentCredential } from '../chatMLFetcher';

/**
 * Only `getExtraHeaders` is consulted, so the rest of the endpoint is irrelevant
 * here — cast a minimal stub rather than building a whole endpoint.
 */
function endpointWithHeaders(headers: Record<string, string> | (() => never)): IChatEndpoint {
	return { getExtraHeaders: typeof headers === 'function' ? headers : () => headers } as unknown as IChatEndpoint;
}

describe('endpointSentCredential', () => {

	it('separates a credential that was sent from one that never reached the wire', () => {
		expect({
			bearer: endpointSentCredential(endpointWithHeaders({ Authorization: 'Bearer sk-or-v1-abc123' })),
			apiKeyHeader: endpointSentCredential(endpointWithHeaders({ 'api-key': 'abc123' })),
			anthropic: endpointSentCredential(endpointWithHeaders({ 'x-api-key': 'sk-ant-abc' })),
			gemini: endpointSentCredential(endpointWithHeaders({ 'x-goog-api-key': 'abc' })),
			caseInsensitive: endpointSentCredential(endpointWithHeaders({ AUTHORIZATION: 'Bearer abc' })),

			// An empty stored key serialises to a bare scheme; that is "nothing sent",
			// and telling the user their key was rejected would be a lie.
			bareScheme: endpointSentCredential(endpointWithHeaders({ Authorization: 'Bearer ' })),
			bareSchemeNoSpace: endpointSentCredential(endpointWithHeaders({ Authorization: 'Bearer' })),
			emptyValue: endpointSentCredential(endpointWithHeaders({ Authorization: '' })),
			noCredentialHeader: endpointSentCredential(endpointWithHeaders({ 'content-type': 'application/json' })),
			noHeadersAtAll: endpointSentCredential(endpointWithHeaders({})),
			noGetExtraHeaders: endpointSentCredential({} as IChatEndpoint),

			// A credential that cannot even be resolved throws on the way out — also "nothing sent".
			throwingResolution: endpointSentCredential(endpointWithHeaders(() => { throw new Error('no key configured'); })),
		}).toEqual({
			bearer: true,
			apiKeyHeader: true,
			anthropic: true,
			gemini: true,
			caseInsensitive: true,
			bareScheme: false,
			bareSchemeNoSpace: false,
			emptyValue: false,
			noCredentialHeader: false,
			noHeadersAtAll: false,
			noGetExtraHeaders: false,
			throwingResolution: false,
		});
	});
});
