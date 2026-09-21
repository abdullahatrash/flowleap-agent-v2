/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { HeadersImpl, Response } from '../../../networking/common/fetcherService';
import { IChatEndpoint } from '../../../networking/common/networking';
import { endpointWithoutAnthropicBetas, isAnthropicBetaFlagRejection, retryWithoutAnthropicBetas } from '../anthropicBetaFallback';

/** The live body from the Bedrock rejection reported in #453, byte for byte. */
const bedrockInvalidBetaFlagBody = '{"type":"error","error":{"type":"invalid_request_error","message":"invalid beta flag"},"metadata":{"provider_name":"Amazon Bedrock","is_byok":false}}';

/** Only `getExtraHeaders`, `model` and `ownsAuthorization` are consulted, so the rest is irrelevant. */
function endpointWithBetas(betas: string | undefined, ownsAuthorization = true): IChatEndpoint {
	return {
		model: 'anthropic/claude-sonnet-5',
		ownsAuthorization,
		getExtraHeaders: () => ({
			'Content-Type': 'application/json',
			'Authorization': 'Bearer sk-or-test',
			...(betas ? { 'anthropic-beta': betas } : {}),
		}),
	} as unknown as IChatEndpoint;
}

function failure(status: number, body: string): Response {
	return Response.fromText(status, 'Bad Request', new HeadersImpl({}), body, 'test-stub');
}

describe('isAnthropicBetaFlagRejection', () => {
	it('matches only a 400 that names an invalid beta flag', () => {
		expect([
			isAnthropicBetaFlagRejection(400, bedrockInvalidBetaFlagBody),
			isAnthropicBetaFlagRejection(400, '{"error":{"message":"max_tokens: must be greater than 0"}}'),
			isAnthropicBetaFlagRejection(422, bedrockInvalidBetaFlagBody),
		]).toEqual([true, false, false]);
	});
});

describe('endpointWithoutAnthropicBetas', () => {
	it('drops the beta header and keeps the credential', () => {
		expect(endpointWithoutAnthropicBetas(endpointWithBetas('interleaved-thinking-2025-05-14')).getExtraHeaders!()).toEqual({
			'Content-Type': 'application/json',
			'Authorization': 'Bearer sk-or-test',
		});
	});
});

describe('retryWithoutAnthropicBetas', () => {
	async function run(response: Response, endpoint: IChatEndpoint) {
		const warnings: string[] = [];
		const refetched: (string | undefined)[] = [];
		const retry = await retryWithoutAnthropicBetas({
			endpoint,
			response,
			refetch: async retryEndpoint => {
				refetched.push(retryEndpoint.getExtraHeaders!()['anthropic-beta']);
				return Response.fromText(200, 'OK', new HeadersImpl({}), 'retried', 'test-stub');
			},
			warn: message => warnings.push(message),
		});
		return { warnings, refetched, body: retry ? await retry.text() : undefined, status: retry?.status };
	}

	it('retries once without the betas on the live Bedrock rejection', async () => {
		expect(await run(failure(400, bedrockInvalidBetaFlagBody), endpointWithBetas('interleaved-thinking-2025-05-14,advanced-tool-use-2025-11-20'))).toEqual({
			refetched: [undefined],
			warnings: [`[anthropicBetaFallback] Provider rejected the beta flags 'interleaved-thinking-2025-05-14,advanced-tool-use-2025-11-20' for model 'anthropic/claude-sonnet-5'; retrying once without them.`],
			body: 'retried',
			status: 200,
		});
	});

	it('does not retry another 400, and hands the read body back unchanged', async () => {
		expect(await run(failure(400, '{"error":{"message":"max_tokens: must be greater than 0"}}'), endpointWithBetas('advanced-tool-use-2025-11-20'))).toEqual({
			refetched: [],
			warnings: [],
			body: '{"error":{"message":"max_tokens: must be greater than 0"}}',
			status: 400,
		});
	});

	it('leaves the response alone when no betas were sent, when the endpoint is not BYOK, or when the status is not 400', async () => {
		expect([
			await run(failure(400, bedrockInvalidBetaFlagBody), endpointWithBetas(undefined)),
			await run(failure(400, bedrockInvalidBetaFlagBody), endpointWithBetas('advanced-tool-use-2025-11-20', /* ownsAuthorization */ false)),
			await run(failure(429, bedrockInvalidBetaFlagBody), endpointWithBetas('advanced-tool-use-2025-11-20')),
		]).toEqual([
			{ refetched: [], warnings: [], body: undefined, status: undefined },
			{ refetched: [], warnings: [], body: undefined, status: undefined },
			{ refetched: [], warnings: [], body: undefined, status: undefined },
		]);
	});
});
