/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { addPatentReaderLinks } from '../../patentai/vscode-node/patentCitationLink';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { IPatentExecutionLedger } from '../../patentai/vscode-node/patentExecutionLedger';
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
	/** Relative path to the backend, e.g. "/tools/get_bibliography" or "/patstat/portfolio" */
	path: string;
	/** HTTP method — defaults to GET */
	method?: 'GET' | 'POST';
	/** JSON-serialised request body for POST requests */
	body?: string;
}

/** Count fields a backend response may carry, in the order they are trusted. */
const COUNT_FIELDS = ['total', 'count', 'totalResults', 'numFound'] as const;

/**
 * The response's own count of matching records, when it states one. This tool calls arbitrary
 * routes, so the count is read rather than derived: the facade nests its payload under `data`, and
 * a body that states no count leaves `rowCount` unknown rather than reporting a fabricated zero.
 */
function reportedCount(result: unknown): number | undefined {
	if (!result || typeof result !== 'object') { return undefined; }
	const body = result as Record<string, unknown>;
	const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : undefined;
	for (const source of [body, data]) {
		for (const field of COUNT_FIELDS) {
			const value = source?.[field];
			if (typeof value === 'number' && Number.isFinite(value) && value >= 0) { return value; }
		}
	}
	return undefined;
}

/**
 * Tool that makes an authenticated request to the FlowLeap backend and returns the JSON response
 * directly to the LLM. Replaces the pattern of running curl in the terminal: authentication is
 * handled by the shared {@link IPatentBackendClient} seam (which also centralizes the
 * `401 → re-sign-in` / `402 → start-trial` gating), so nothing leaks to the user's terminal.
 *
 * The escape hatch for capabilities with no typed tool of their own. Since patent data is reached
 * through the `/v1/tools` facade, that means `POST /tools/<tool_name>` with the tool's JSON input —
 * the `*_api_guide` tools name the tool and publish its schema. PATSTAT is the exception the backend
 * kept as a route surface, so `/patstat/...` paths are still called directly.
 */
export class PatentApiRequestTool implements ICopilotTool<IPatentApiRequestParams> {

	public static readonly toolName = ToolName.PatentApiRequest;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IPatentExecutionLedger private readonly ledger: IPatentExecutionLedger,
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
		// The request as SENT, so an audited number can be traced back to the exact call that produced it.
		const recordedRequest = [`${method} ${normalisedPath}`, bodyStr?.trim()].filter(Boolean).join(' ');

		try {
			let result: unknown;
			// Kept in scope for the single-record classifier: a by-number lookup can carry its document
			// number in the body (`POST …/search` with `q: "patentNumber:…"`) rather than in the path.
			let parsedBody: unknown;

			if (method === 'POST') {
				// Parse body string
				parsedBody = {};
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
			// an empty result with a "refine your query" note that a by-number lookup cannot act on. The
			// classifier reads the response as well as the request, because a by-number lookup routed through
			// a search endpoint is only recognisable from the single record it came back with.
			const singleRecord = isSingleRecordDocumentLookup({ path: normalisedPath, body: parsedBody }, result);
			const formatted = formatJsonForModel(addPatentReaderLinks(result), ToolResponseBudgets.PatentApiRequest, { singleRecord });

			// Recorded for the audit only; the tool's answer is unchanged by the outcome of the write.
			await this.ledger.record(options.chatSessionResource, {
				kind: 'analytics', status: 'succeeded', tool: 'patent_api_request', request: recordedRequest,
				rowCount: reportedCount(result), resultText: formatted.content,
			});

			return new LanguageModelToolResult([new LanguageModelTextPart(formatted.content)]);

		} catch (error) {
			await this.ledger.record(options.chatSessionResource, { kind: 'analytics', status: token.isCancellationRequested ? 'cancelled' : 'failed', tool: 'patent_api_request', request: recordedRequest });
			return handlePatentToolError(error, this.logService, '[PatentApiRequestTool]', err => `Backend error ${err.status}: ${err.message}`);
		}
	}
}

ToolRegistry.registerTool(PatentApiRequestTool);
