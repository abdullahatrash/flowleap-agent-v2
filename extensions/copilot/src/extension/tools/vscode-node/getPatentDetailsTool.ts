/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError } from '../../patentai/vscode-node/patentBackendClient';
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface IGetPatentDetailsParams {
	publicationNumber: string;
}

/** `data` payload of the `get_bibliography` facade tool. */
interface BiblioData {
	docId: string;
	title: string | null;
	abstract: string | null;
	applicants: string[];
	inventors: string[];
	ipc: string[];
	cpc: string[];
	dates: {
		filing: string | null;
		publication: string | null;
		priority: string[];
	};
}

/** `data` payload of the `get_claims` facade tool — numbered claims, not bare strings. */
interface ClaimsData {
	docId: string;
	claims: { number: string; text: string }[];
	totalClaims: number;
	language: string;
}

/** `data` payload of the `get_description` facade tool. */
interface DescriptionData {
	docId: string;
	description: string | null;
	language: string;
}

/**
 * Tool for retrieving full patent details (bibliographic data + claims + description) through the
 * FlowLeap backend's `/v1/tools` facade — `get_bibliography`, `get_claims`, `get_description` — via
 * the shared {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating.
 *
 * The facade routes full text per office (EP/WO through EPO OPS, US claims through BigQuery), so a
 * missing section is a structured verdict rather than a coverage assumption; a section that fails
 * degrades to the fallback line instead of failing the whole tool.
 */
export class GetPatentDetailsTool implements ICopilotTool<IGetPatentDetailsParams> {

	public static readonly toolName = ToolName.GetPatentDetails;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetPatentDetailsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching patent details for ${publicationNumber}...`,
		};
	}

	/**
	 * Normalize a publication number to the OPS epodoc format (US10000000B2). Search results and
	 * user input may carry hyphens, dots, or spaces (US-10000000-B2); epodoc wants them stripped.
	 * Kind-code edge cases are handled server-side by cleanDocumentId.
	 */
	private normalizePublicationNumber(pubNum: string): string {
		return pubNum.replace(/[-.\s/]/g, '').toUpperCase();
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentDetailsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetPatentDetailsTool] Invoking patent details fetch');

		const { publicationNumber } = options.input;
		const doc = this.normalizePublicationNumber(publicationNumber);
		this.logService.info(`[GetPatentDetailsTool] Normalized: ${publicationNumber} -> ${doc}`);

		try {
			const biblioPromise = callFacadeTool<BiblioData>(this.patentBackendClient, 'get_bibliography', { patent_number: doc }, token);
			const claimsPromise = this.fetchOptionalSection<ClaimsData>('get_claims', doc, token);
			const descriptionPromise = this.fetchOptionalSection<DescriptionData>('get_description', doc, token);

			const biblio = await biblioPromise;
			const [claims, description] = await Promise.all([claimsPromise, descriptionPromise]);

			const formattedResponse = this.formatPatentDetails(biblio, claims, description, doc);
			this.logService.info(`[GetPatentDetailsTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			return handlePatentToolError(
				error,
				this.logService,
				'[GetPatentDetailsTool]',
				err => `Error fetching patent ${publicationNumber}: ${err.status} - ${err.message}`,
				err => err.status === 404 ? `\n\n${this.usptoFallbackHint(doc)}` : '',
			);
		}
	}

	/**
	 * Fetch an optional full-text section through the facade. Full text is not published for every
	 * office and section, so a failure here must not fail the whole tool — return null and let the
	 * formatter point at the fallback. Cancellation still propagates, and so do the seam's typed
	 * gating errors: the same guards protect `get_bibliography`, so surfacing them once there is enough.
	 */
	private async fetchOptionalSection<T>(toolName: string, doc: string, token: CancellationToken): Promise<T | null> {
		try {
			return await callFacadeTool<T>(this.patentBackendClient, toolName, { patent_number: doc }, token);
		} catch (error) {
			if (error instanceof PatentBackendError && error.message === 'Request cancelled.') {
				throw error;
			}
			this.logService.info(`[GetPatentDetailsTool] Optional section ${toolName} unavailable for ${doc}: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}

	private usptoFallbackHint(doc: string): string {
		return `For a US document, the full file wrapper is available from the USPTO: use get_us_grant with the bare numeric patent number (${doc.replace(/^US/, '').replace(/[A-Z]\d?$/, '')}), or search_patents with provider="uspto".`;
	}

	/**
	 * Format patent details for LLM consumption
	 */
	private formatPatentDetails(biblio: BiblioData, claims: ClaimsData | null, description: DescriptionData | null, doc: string): string {
		const countryCode = biblio.docId?.substring(0, 2) || doc.substring(0, 2);
		const fulltextFallback = `Full text is not available for this document and section. ${this.usptoFallbackHint(doc)}`;

		const lines: string[] = [
			`# Patent: ${biblio.docId || doc}`,
			'',
			`**Title:** ${biblio.title || 'N/A'}`,
			`**Country:** ${countryCode}`,
			`**Filing Date:** ${biblio.dates?.filing || 'N/A'}`,
			`**Publication Date:** ${biblio.dates?.publication || 'N/A'}`,
			`**Priority Date(s):** ${biblio.dates?.priority?.length > 0 ? biblio.dates.priority.join(', ') : 'N/A'}`,
			'',
			`**Applicants:** ${biblio.applicants?.length > 0 ? biblio.applicants.join(', ') : 'N/A'}`,
			`**Inventors:** ${biblio.inventors?.length > 0 ? biblio.inventors.join(', ') : 'N/A'}`,
			'',
			`**IPC Classifications:** ${biblio.ipc?.length > 0 ? biblio.ipc.join(', ') : 'N/A'}`,
			`**CPC Classifications:** ${biblio.cpc?.length > 0 ? biblio.cpc.join(', ') : 'N/A'}`,
			'',
			'## Abstract',
			biblio.abstract || 'No abstract available.',
			'',
			'## Claims',
			claims && claims.claims.length > 0 ? claims.claims.map(c => c.text).join('\n\n') : fulltextFallback,
			'',
			'## Description',
			description?.description || fulltextFallback,
			'',
			'---',
			'For citations use search_citations / search_forward_citations; for the patent family use get_patent_family.',
		];

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetPatentDetailsTool);
