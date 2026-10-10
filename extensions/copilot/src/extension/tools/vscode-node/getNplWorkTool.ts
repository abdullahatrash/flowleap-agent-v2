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
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface IGetNplWorkParams {
	reference: string;
}

/** The OpenAlex record `get_npl_work` returns for a matched reference. */
interface NplWork {
	id: string;
	doi: string | null;
	title: string;
	abstract: string | null;
	publicationDate: string | null;
	type?: string;
	citedByCount?: number;
	isOpenAccess?: boolean;
	openAccessUrl: string | null;
	authors?: string[];
	source: string | null;
}

/** A similar work offered when no match is certain. */
interface NplCandidate {
	work: { id: string; doi: string | null; title: string; publicationDate: string | null; source: string | null };
	score: number;
}

/** `data` payload of the `get_npl_work` facade tool. */
interface NplResolutionData {
	reference?: string;
	parsed?: { doi: string | null; openalexId: string | null; title: string | null; year: number | null; xpNumber: string | null };
	status: 'matched' | 'candidates' | 'not_found';
	method: 'openalex_id' | 'doi' | 'title' | null;
	confidence: number | null;
	work: NplWork | null;
	candidates?: NplCandidate[];
}

/**
 * Resolves one cited non-patent reference (a citation string exactly as an office printed it, a DOI
 * or an OpenAlex work id) to its OpenAlex record through the FlowLeap backend's `get_npl_work`
 * facade tool. The backend never guesses: a match that is not certain comes back as candidates,
 * which this tool renders as possible matches only, so the model does not read another paper's
 * abstract as the cited one.
 */
export class GetNplWorkTool implements ICopilotTool<IGetNplWorkParams> {

	public static readonly toolName = ToolName.GetNplWork;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetNplWorkParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: l10n.t`Looking up cited paper: ${shorten(options.input.reference ?? '')}`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetNplWorkParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const reference = options.input.reference?.trim() ?? '';
		if (reference.length < 3) {
			return new LanguageModelToolResult([new LanguageModelTextPart('Error: No reference provided. Pass a DOI, an OpenAlex work id (W…) or the cited-NPL string exactly as the office printed it.')]);
		}

		try {
			const data = await callFacadeTool<NplResolutionData>(this.patentBackendClient, 'get_npl_work', { reference }, token);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatNplResolution(data, reference))]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetNplWorkTool]', err => `Error: cited-paper lookup returned ${err.status}: ${err.message}`);
		}
	}
}

function shorten(text: string): string {
	const value = text.trim();
	return value.length > 80 ? value.substring(0, 80) + '…' : value;
}

function formatNplResolution(data: NplResolutionData, reference: string): string {
	const lines: string[] = [`Reference: ${data.reference ?? reference}`];
	if (data.parsed?.xpNumber) {
		lines.push(`EPO NPL accession number: ${data.parsed.xpNumber}`);
	}

	if (data.status === 'matched' && data.work) {
		const work = data.work;
		const how = data.method === 'title' ? `title match, similarity ${data.confidence ?? '?'}` : `by ${data.method === 'openalex_id' ? 'OpenAlex id' : 'DOI'}`;
		lines.push(`Status: matched (${how}). This is the cited work.`, '', work.title);
		if (work.authors?.length) {
			lines.push(`Authors: ${work.authors.join(', ')}`);
		}
		const published = [work.publicationDate && `Published: ${work.publicationDate}`, work.source && `in ${work.source}`].filter(Boolean).join(' ');
		if (published) {
			lines.push(published);
		}
		if (work.type || work.citedByCount !== undefined) {
			lines.push([work.type && `Type: ${work.type}`, work.citedByCount !== undefined && `Citations: ${work.citedByCount}`].filter(Boolean).join(' · '));
		}
		if (work.doi) {
			lines.push(`DOI: https://doi.org/${work.doi}`);
		}
		if (work.openAccessUrl) {
			lines.push(`Open access: ${work.openAccessUrl}`);
		}
		lines.push(`OpenAlex: https://openalex.org/${work.id}`);
		lines.push('', `Abstract: ${work.abstract ?? 'not in OpenAlex; open the DOI or open-access link with fetch_webpage to read the paper.'}`);
		lines.push('', 'The publication date here is OpenAlex\'s (often the online-first date); the office\'s printed date may be later. Check the one that governs against the critical date.');
		return lines.join('\n');
	}

	const candidates = data.candidates ?? [];
	if (data.status === 'candidates' && candidates.length) {
		lines.push('Status: candidates. OpenAlex has similar works but none is certainly the cited one. Report them as possible matches only; never cite one as the cited paper or read its abstract as the cited disclosure.', '');
		candidates.forEach((candidate, i) => {
			const facts = [candidate.work.publicationDate, candidate.work.source, candidate.work.doi && `DOI ${candidate.work.doi}`, `title similarity ${candidate.score}`].filter(Boolean).join(', ');
			lines.push(`${i + 1}. ${candidate.work.title} (${facts}) — OpenAlex ${candidate.work.id}`);
		});
		return lines.join('\n');
	}

	lines.push('Status: not found. OpenAlex has no similar work. Standards, product manuals, web pages and many conference abstracts are absent from it; try search_npl with the title words, or fetch_webpage on a URL the reference names.');
	return lines.join('\n');
}

ToolRegistry.registerTool(GetNplWorkTool);
