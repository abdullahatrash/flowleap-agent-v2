/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError, patentBackendErrorRecoveryHint } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface IGetPatentDetailsParams {
	publicationNumber: string;
}

interface OpsEnvelope<T> {
	success: boolean;
	data?: T;
	error?: string;
}

interface OpsBiblioData {
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

interface OpsClaimsData {
	docId: string;
	lang: string;
	claims: string[];
}

interface OpsDescriptionData {
	docId: string;
	lang: string;
	description: string;
}

/**
 * Tool for retrieving full patent details (bibliographic data + claims + description) from EPO OPS
 * via the FlowLeap backend (`/ops/biblio` + `/ops/fulltext/*`). Routes through the shared
 * {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating. OPS full text covers mainly EP and WO publications; for other
 * jurisdictions the biblio section still resolves and the output points the model at the
 * USPTO fallback.
 */
class GetPatentDetailsTool implements ICopilotTool<IGetPatentDetailsParams> {

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
			const biblioPromise = this.patentBackendClient.get<OpsEnvelope<OpsBiblioData>>(
				`/ops/biblio?${new URLSearchParams({ doc }).toString()}`, token);
			const claimsPromise = this.fetchOptionalSection<OpsClaimsData>('/ops/fulltext/claims', doc, token);
			const descriptionPromise = this.fetchOptionalSection<OpsDescriptionData>('/ops/fulltext/description', doc, token);

			const biblio = await biblioPromise;
			if (!biblio.success || !biblio.data) {
				const errorMsg = biblio.error || `Patent not found: ${publicationNumber}`;
				this.logService.error(`[GetPatentDetailsTool] Error: ${errorMsg}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`${errorMsg}\n\n${this.usptoFallbackHint(doc)}`)
				]);
			}

			const [claims, description] = await Promise.all([claimsPromise, descriptionPromise]);

			const formattedResponse = this.formatPatentDetails(biblio.data, claims, description, doc);
			this.logService.info(`[GetPatentDetailsTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[GetPatentDetailsTool] Backend error ${error.status}: ${error.message}`);
				const notFoundHint = error.status === 404 ? `\n\n${this.usptoFallbackHint(doc)}` : '';
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error fetching patent ${publicationNumber}: ${error.status} - ${error.message}` + patentBackendErrorRecoveryHint(error) + notFoundHint)
				]);
			}
			this.logService.error(`[GetPatentDetailsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Fetch an optional full-text section. OPS full text is only published for some jurisdictions
	 * (mainly EP/WO), so a 404 here must not fail the whole tool — return null and let the
	 * formatter point at the fallback. Auth/subscription errors (401/402) and cancellation still
	 * propagate: the same guards protect `/ops/biblio`, so surfacing them once there is enough.
	 */
	private async fetchOptionalSection<T>(path: string, doc: string, token: CancellationToken): Promise<T | null> {
		try {
			const result = await this.patentBackendClient.get<OpsEnvelope<T>>(
				`${path}?${new URLSearchParams({ doc }).toString()}`, token);
			return result.success && result.data ? result.data : null;
		} catch (error) {
			if (error instanceof PatentBackendError && error.message === 'Request cancelled.') {
				throw error;
			}
			this.logService.info(`[GetPatentDetailsTool] Optional section ${path} unavailable for ${doc}: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}

	private usptoFallbackHint(doc: string): string {
		return `For US patents, full text is available via the USPTO: use patent_api_request with GET /patent-search-uspto/grants/${doc.replace(/^US/, '').replace(/[A-Z]\d?$/, '')} or POST /patent-search-uspto/search.`;
	}

	/**
	 * Format patent details for LLM consumption
	 */
	private formatPatentDetails(biblio: OpsBiblioData, claims: OpsClaimsData | null, description: OpsDescriptionData | null, doc: string): string {
		const countryCode = biblio.docId?.substring(0, 2) || doc.substring(0, 2);
		const fulltextFallback = `Not available via EPO OPS for this document (full text is published mainly for EP/WO). ${this.usptoFallbackHint(doc)}`;

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
			claims && claims.claims.length > 0 ? claims.claims.join('\n\n') : fulltextFallback,
			'',
			'## Description',
			description?.description || fulltextFallback,
			'',
			'---',
			`For citations use search_citations / search_forward_citations; for the patent family use patent_api_request with GET /ops/family?doc=${doc}.`,
		];

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetPatentDetailsTool);
