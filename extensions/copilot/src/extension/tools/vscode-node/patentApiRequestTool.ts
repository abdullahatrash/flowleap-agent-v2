/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { normaliseToRelativePath } from './curlToApiRequest';
import { formatJsonForModel, isSingleRecordDocumentLookup, ToolResponseBudgets } from './patentResponseFormatter';

/**
 * Input parameters for the patent_api_request tool.
 * Kept intentionally flat so the LLM can supply values without constructing nested objects.
 */
interface IPatentApiRequestParams {
	/** Relative path to the backend endpoint, e.g. "/ops/biblio?doc=EP1234566" */
	path: string;
	/** HTTP method — defaults to GET */
	method?: 'GET' | 'POST';
	/** JSON-serialised request body for POST requests */
	body?: string;
}

/**
 * Tool that makes an authenticated request to the FlowLeap backend and returns the JSON response
 * directly to the LLM. Replaces the pattern of running curl in the terminal: authentication is
 * handled by the shared {@link IPatentBackendClient} seam (which also centralizes the
 * `401 → re-sign-in` / `402 → start-trial` gating), so nothing leaks to the user's terminal.
 */
class PatentApiRequestTool implements ICopilotTool<IPatentApiRequestParams> {

	public static readonly toolName = ToolName.PatentApiRequest;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IPatentApiRequestParams>,
		_token: CancellationToken
	): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { path, method = 'GET' } = options.input;
		return {
			invocationMessage: l10n.t`Calling backend: ${method} ${path}`
		};
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IPatentApiRequestParams>,
		token: CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const { path: rawPath, method = 'GET', body: bodyStr } = options.input;

		this.logService.trace(`[PatentApiRequestTool] Invoking ${method} ${rawPath}`);

		// Normalise path: strip scheme+host and leading /v1 so the client can prepend apiUrl correctly
		const normalisedPath = normaliseToRelativePath(rawPath);

		try {
			let result: unknown;

			if (method === 'POST') {
				// Parse body string
				let parsedBody: unknown = {};
				if (bodyStr && bodyStr.trim().length > 0) {
					try {
						parsedBody = JSON.parse(bodyStr);
					} catch {
						return new LanguageModelToolResult([
							new LanguageModelTextPart(
								`Error: body is not valid JSON — "${bodyStr.substring(0, 200)}". ` +
								'Please supply a valid JSON string for the body parameter.'
							)
						]);
					}
				}
				result = await this.patentBackendClient.post<unknown>(normalisedPath, parsedBody, token);
			} else {
				result = await this.patentBackendClient.get<unknown>(normalisedPath, token);
			}

			// Route through the shared budget-aware formatter: under budget the output is the same
			// pretty-printed JSON as before; oversized responses come back as valid, parseable JSON with
			// whole array items dropped and an explicit omitted-count note (never sliced mid-structure).
			// Single-record document lookups (by-number claims/description/grant fetches) instead keep their
			// sole record intact so the harness offloads the full text to a file — dropping it would return
			// an empty result with a "refine your query" note that a by-number lookup cannot act on.
			const singleRecord = isSingleRecordDocumentLookup(normalisedPath);
			const formatted = formatJsonForModel(result, ToolResponseBudgets.PatentApiRequest, { singleRecord });

			return new LanguageModelToolResult([new LanguageModelTextPart(formatted.content)]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[PatentApiRequestTool]', err => `Backend error ${err.status}: ${err.message}`);
		}
	}
}

ToolRegistry.registerTool(PatentApiRequestTool);
