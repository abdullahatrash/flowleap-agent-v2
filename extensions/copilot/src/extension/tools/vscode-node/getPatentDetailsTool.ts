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
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface IGetPatentDetailsParams {
	publicationNumber: string;
}

interface PatentDetails {
	publicationNumber: string;
	countryCode: string;
	kindCode: string;
	title: string | null;
	abstract: string | null;
	claims: string | null;
	description: string | null;
	applicants: string[];
	inventors: string[];
	filingDate: string | null;
	publicationDate: string | null;
	priorityDate: string | null;
	ipc: string[];
	cpc: string[];
	citationCount: number;
	familyId: string | null;
}

interface PatentDetailsResult {
	success: boolean;
	patent?: PatentDetails;
	error?: string;
}

/**
 * Tool for retrieving full patent details (claims + description) from the Google Patents BigQuery
 * dataset via the FlowLeap backend. Routes through the shared {@link IPatentBackendClient} seam, so it
 * inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating.
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
	 * Normalize a publication number to the BigQuery format (US-10000000-B2). EPO returns
	 * un-hyphenated numbers (US10000000B2, EP1234567A1); BigQuery expects hyphens between the
	 * country code, number, and kind code.
	 */
	private normalizePublicationNumber(pubNum: string): string {
		// Already hyphenated — return as-is.
		if (pubNum.includes('-')) {
			return pubNum;
		}

		// Match CountryCode + Number + KindCode (e.g. US10000000B2, EP1234567A1, WO2020123456A1).
		const match = pubNum.match(/^(?<country>[A-Z]{2})(?<number>\d+)(?<kind>[A-Z]\d?)$/);
		if (match?.groups) {
			const { country, number, kind } = match.groups;
			return `${country}-${number}-${kind}`;
		}

		// No match — return as-is and let the backend handle it.
		return pubNum;
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentDetailsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetPatentDetailsTool] Invoking patent details fetch');

		const { publicationNumber } = options.input;
		const normalizedPubNum = this.normalizePublicationNumber(publicationNumber);
		this.logService.info(`[GetPatentDetailsTool] Normalized: ${publicationNumber} -> ${normalizedPubNum}`);

		try {
			const path = `/patent-search-bq/${encodeURIComponent(normalizedPubNum)}`;
			this.logService.info(`[GetPatentDetailsTool] Calling backend: ${path}`);

			const result = await this.patentBackendClient.get<PatentDetailsResult>(path, token);

			this.logService.info(`[GetPatentDetailsTool] Result success: ${result.success}`);

			if (!result.success || !result.patent) {
				const errorMsg = result.error || `Patent not found: ${publicationNumber}`;
				this.logService.error(`[GetPatentDetailsTool] Error: ${errorMsg}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(errorMsg)
				]);
			}

			// Format results for LLM
			const formattedResponse = this.formatPatentDetails(result.patent);
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
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error fetching patent ${publicationNumber}: ${error.status} - ${error.message}`)
				]);
			}
			this.logService.error(`[GetPatentDetailsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Format patent details for LLM consumption
	 */
	private formatPatentDetails(patent: PatentDetails): string {
		const lines: string[] = [
			`# Patent: ${patent.publicationNumber}`,
			'',
			`**Title:** ${patent.title || 'N/A'}`,
			`**Country:** ${patent.countryCode} | **Kind:** ${patent.kindCode}`,
			`**Filing Date:** ${patent.filingDate || 'N/A'}`,
			`**Publication Date:** ${patent.publicationDate || 'N/A'}`,
			`**Priority Date:** ${patent.priorityDate || 'N/A'}`,
			'',
			`**Applicants:** ${patent.applicants?.length > 0 ? patent.applicants.join(', ') : 'N/A'}`,
			`**Inventors:** ${patent.inventors?.length > 0 ? patent.inventors.join(', ') : 'N/A'}`,
			'',
			`**IPC Classifications:** ${patent.ipc?.length > 0 ? patent.ipc.join(', ') : 'N/A'}`,
			`**CPC Classifications:** ${patent.cpc?.length > 0 ? patent.cpc.join(', ') : 'N/A'}`,
			`**Citation Count:** ${patent.citationCount || 0}`,
			`**Family ID:** ${patent.familyId || 'N/A'}`,
			'',
			'## Abstract',
			patent.abstract || 'No abstract available.',
			'',
			'## Claims',
			patent.claims || 'No claims available.',
			'',
			'## Description',
			patent.description || 'No description available.',
		];

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetPatentDetailsTool);
