/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatLocation } from '../../chat/common/commonTypes';
import { Response } from '../../networking/common/fetcherService';
import { IChatEndpoint, InteractionTypeOverride } from '../../networking/common/networking';

/** The header carrying Anthropic beta opt-ins. Lower-case: HTTP header names are case-insensitive. */
export const anthropicBetaHeaderName = 'anthropic-beta';

/**
 * What a provider answers when it does not recognise one of the betas we asked for. Seen from
 * Amazon Bedrock through OpenRouter's Messages endpoint: OpenRouter load-balances one Claude
 * model across Anthropic, Bedrock and Vertex, and only Anthropic accepts every flag we send,
 * so the same request succeeds or fails by which provider took it.
 */
const invalidBetaFlagMessage = 'invalid beta flag';

/**
 * Whether a failed request failed *because* of the betas we sent. Deliberately narrow: any other
 * 400 is a real client error and must reach the user unchanged.
 */
export function isAnthropicBetaFlagRejection(status: number, body: string): boolean {
	return status === 400 && body.toLowerCase().includes(invalidBetaFlagMessage);
}

/** The `anthropic-beta` value an endpoint puts on the wire, or `undefined` when it sends none. */
export function anthropicBetasOf(endpoint: IChatEndpoint, location?: ChatLocation, interactionTypeOverride?: InteractionTypeOverride): string | undefined {
	let headers: Record<string, string>;
	try {
		headers = endpoint.getExtraHeaders?.(location, interactionTypeOverride) ?? {};
	} catch {
		// A credential that cannot be resolved throws here; that request has a different problem.
		return undefined;
	}
	const beta = Object.entries(headers).find(([name]) => name.toLowerCase() === anthropicBetaHeaderName)?.[1];
	return beta ? beta : undefined;
}

/**
 * The same endpoint with `anthropic-beta` stripped from its headers. Everything else — the
 * credential, the URL, the tokenizer, the response processing — stays the endpoint's own.
 */
export function endpointWithoutAnthropicBetas(endpoint: IChatEndpoint): IChatEndpoint {
	return new Proxy(endpoint, {
		get(target, prop, receiver) {
			if (prop === 'getExtraHeaders') {
				return (location?: ChatLocation, interactionTypeOverride?: InteractionTypeOverride) => {
					const headers = { ...(target.getExtraHeaders?.(location, interactionTypeOverride) ?? {}) };
					for (const name of Object.keys(headers)) {
						if (name.toLowerCase() === anthropicBetaHeaderName) {
							delete headers[name];
						}
					}
					return headers;
				};
			}
			if (prop === 'acquireTokenizer') {
				return target.acquireTokenizer.bind(target);
			}
			return Reflect.get(target, prop, receiver);
		}
	});
}

export interface IAnthropicBetaRetryOptions {
	/** The endpoint whose headers produced the failure. */
	readonly endpoint: IChatEndpoint;
	/** The failed response. Its body is read only when a beta rejection is possible. */
	readonly response: Response;
	readonly location?: ChatLocation;
	readonly interactionTypeOverride?: InteractionTypeOverride;
	/** Sends the identical request again, for the beta-free endpoint handed to it. */
	readonly refetch: (endpoint: IChatEndpoint) => Promise<Response>;
	readonly warn: (message: string) => void;
}

/**
 * Sends one more attempt without the `anthropic-beta` header when — and only when — a provider
 * rejected the betas themselves. A beta flag is an optimisation, so losing it costs a feature;
 * failing the turn costs the user their answer.
 *
 * Returns the response to use in place of {@link IAnthropicBetaRetryOptions.response}, or
 * `undefined` when nothing was read and the original response still stands. Reading the body
 * consumes the stream, so once read the text is always handed back in a replacement response.
 */
export async function retryWithoutAnthropicBetas(options: IAnthropicBetaRetryOptions): Promise<Response | undefined> {
	const { endpoint, response } = options;
	// `ownsAuthorization` is what marks an endpoint the user configured (BYOK, OpenRouter, the
	// FlowLeap trial key, a custom endpoint). CAPI is asked for these betas on purpose.
	if (response.status !== 400 || !endpoint.ownsAuthorization) {
		return undefined;
	}
	const betas = anthropicBetasOf(endpoint, options.location, options.interactionTypeOverride);
	if (!betas) {
		return undefined;
	}
	const text = await response.text();
	if (!isAnthropicBetaFlagRejection(response.status, text)) {
		return Response.fromText(response.status, response.statusText, response.headers, text, response.fetcher);
	}
	options.warn(`[anthropicBetaFallback] Provider rejected the beta flags '${betas}' for model '${endpoint.model}'; retrying once without them.`);
	return options.refetch(endpointWithoutAnthropicBetas(endpoint));
}
