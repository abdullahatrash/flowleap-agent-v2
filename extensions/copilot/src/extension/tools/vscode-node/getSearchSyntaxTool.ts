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
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';

type SearchSyntaxProvider = 'epo_ops' | 'uspto' | 'epo_register';

interface IGetSearchSyntaxParams {
	provider?: SearchSyntaxProvider;
}

/**
 * The `data` payload of the backend's `get_search_syntax` tool. `fields` and `examples` are the
 * shape served today; every other key is rendered generically, so the backend can add a section
 * (rules, coverage, dates) and the model reads it without an app release.
 */
interface SearchSyntaxData {
	provider?: string;
	language?: string;
	summary?: string;
	fields?: Record<string, string>;
	examples?: readonly string[];
	[section: string]: unknown;
}

/** Keys rendered by name, in this order, before the generic sections. */
const NAMED_KEYS: ReadonlySet<string> = new Set(['provider', 'language', 'summary', 'fields', 'examples']);

/**
 * Tool that serves the query grammar of a search provider from the backend's `get_search_syntax`
 * facade tool: the field list, the rules OPS enforces and worked examples. The grammar lives
 * next to the search client that compiles the query, so the text the model reads is the text the
 * backend maintains; the patent-search skill holds the method and points here for the syntax.
 */
export class GetSearchSyntaxTool implements ICopilotTool<IGetSearchSyntaxParams> {

	public static readonly toolName = ToolName.GetSearchSyntax;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetSearchSyntaxParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const provider = options.input.provider ?? 'epo_ops';
		return {
			invocationMessage: l10n.t`Reading the ${provider} query grammar`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetSearchSyntaxParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const provider: SearchSyntaxProvider = options.input.provider ?? 'epo_ops';
		this.logService.trace(`[GetSearchSyntaxTool] Reading the ${provider} grammar`);
		try {
			const data = await callFacadeTool<SearchSyntaxData>(this.patentBackendClient, 'get_search_syntax', { provider }, token);
			return new LanguageModelToolResult([new LanguageModelTextPart(renderSearchSyntax(data))]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetSearchSyntaxTool]', err => `Error: the search grammar could not be read (backend returned ${err.status}: ${err.message}).`);
		}
	}
}

function renderSearchSyntax(data: SearchSyntaxData): string {
	const lines: string[] = [`# ${data.language ?? data.provider ?? 'Search'} grammar`];
	if (data.summary) {
		lines.push('', data.summary);
	}
	const fields = Object.entries(data.fields ?? {});
	if (fields.length > 0) {
		lines.push('', '## Fields', '', '| Field | Meaning |', '| --- | --- |');
		for (const [field, meaning] of fields) {
			lines.push(`| \`${field}\` | ${meaning} |`);
		}
	}
	for (const [section, value] of Object.entries(data)) {
		if (NAMED_KEYS.has(section) || value === undefined || value === null) {
			continue;
		}
		lines.push('', `## ${sectionTitle(section)}`, '', ...renderSection(value));
	}
	if (data.examples && data.examples.length > 0) {
		lines.push('', '## Examples', '', ...data.examples.map(example => `- \`${example}\``));
	}
	return lines.join('\n');
}

function sectionTitle(key: string): string {
	const words = key.replace(/[_-]+/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function renderSection(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map(item => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`);
	}
	if (typeof value === 'object') {
		return Object.entries(value as Record<string, unknown>).map(([key, item]) => `- **${key}**: ${typeof item === 'string' ? item : JSON.stringify(item)}`);
	}
	return [String(value)];
}

ToolRegistry.registerTool(GetSearchSyntaxTool);
