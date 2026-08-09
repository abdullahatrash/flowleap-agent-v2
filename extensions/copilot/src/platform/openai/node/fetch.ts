/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestId } from '../../networking/common/fetch';
import { ChatCompletion } from '../../networking/common/openai';

export enum FetchResponseKind {
	Success = 'success',
	Failed = 'failed',
	Canceled = 'canceled',
}

export interface ChatResults {
	type: FetchResponseKind.Success;
	chatCompletions: AsyncIterable<ChatCompletion>;
}

export interface ChatRequestFailed {
	type: FetchResponseKind.Failed;
	modelRequestId: RequestId | undefined;
	failKind: ChatFailKind;
	reason: string;
	data?: Record<string, any>;
}

export interface ChatRequestCanceled {
	type: FetchResponseKind.Canceled;
	reason: string;
}

export enum ChatFailKind {
	OffTopic = 'offTopic',
	TokenExpiredOrInvalid = 'tokenExpiredOrInvalid',
	/**
	 * A BYOK endpoint (one that owns its own `Authorization`, see
	 * `IChatEndpoint.ownsAuthorization`) rejected the user-supplied credential.
	 * Distinct from {@link TokenExpiredOrInvalid}, which is about the CAPI
	 * Copilot token and triggers a token reset the user cannot act on.
	 */
	ProviderAuthFailed = 'providerAuthFailed',
	ServerCanceled = 'serverCanceled',
	ClientNotSupported = 'clientNotSupported',
	RateLimited = 'rateLimited',
	QuotaExceeded = 'quotaExceeded',
	ExtensionBlocked = 'extensionBlocked',
	ServerError = 'serverError',
	ContentFilter = 'contentFilter',
	AgentUnauthorized = 'unauthorized',
	AgentFailedDependency = 'failedDependency',
	ValidationFailed = 'validationFailed',
	InvalidPreviousResponseId = 'invalidPreviousResponseId',
	NotFound = 'notFound',
	Unknown = 'unknown',
}
