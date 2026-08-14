/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { IPatentBackendClient, IPatentBackendRequestOptions, PatentBackendError } from '../../../patentai/vscode-node/patentBackendClient';
import { CitationApiGuideTool } from '../citationApiGuideTool';
import { OpsApiGuideTool } from '../opsApiGuideTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/**
 * A `GET /v1/tools` registry payload in the shape the backend serves it: a version stamp plus one
 * entry per tool carrying description, input schema and reference docs.
 */
const REGISTRY = {
	success: true,
	apiVersion: '1.4.0+abc1234',
	docsVersion: '1.0.0',
	lastModified: '2026-08-14T00:00:00Z',
	tools: [
		{
			name: 'get_bibliography',
			description: 'Bibliographic data for any publication number via EPO OPS worldwide coverage. Second sentence.',
			inputSchema: { type: 'object', properties: { patent_number: { type: 'string' } }, required: ['patent_number'] },
			docs: {
				usage: 'Start here for title, applicants and dates.',
				params: { patent_number: 'Publication number, e.g. EP1000000.' },
				examples: [{ description: 'EP publication', input: { patent_number: 'EP1000000' } }],
			},
		},
		{
			name: 'search_office_action_citations',
			description: 'Examiner-cited prior art from USPTO office actions.',
			inputSchema: { type: 'object', properties: { application_number: { type: 'string' } } },
			docs: {
				usage: 'Filter by category, examiner_cited_only and date_range.',
				examples: [{ description: 'X-category only', input: { application_number: '16123456', category: 'X' } }],
				recipes: [{
					name: 'novelty',
					description: 'The X-category references the examiner held to destroy novelty on their own.',
					input: { application_number: '16123456', category: 'X', examiner_cited_only: true },
				}],
			},
		},
	],
};

/** A client whose `get` answers with the registry payload (or throws), recording the paths asked for. */
function makeBackendClient(getResult: unknown | (() => never)) {
	const calls: string[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		async post<T>(): Promise<T> { throw new Error('the guide tools do not POST'); },
		async get<T>(pathWithQuery: string, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push(pathWithQuery);
			if (typeof getResult === 'function') {
				return (getResult as () => never)();
			}
			return getResult as T;
		},
	};
	return { client, calls };
}

function makeToken(): CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested() {
			return { dispose: () => { /* noop */ } };
		},
	};
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function textOf(result: vscode.LanguageModelToolResult): string {
	const part = result.content[0];
	return (part as LanguageModelTextPart).value;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registry-backed API guide tools', () => {

	it('reads the versioned tool registry, not a per-family docs manifest', async () => {
		const { client, calls } = makeBackendClient(REGISTRY);
		const tool = new OpsApiGuideTool(makeLogService(), client);

		await tool.invoke(makeOptions({ action: 'list' as const }), makeToken());

		expect(calls).toEqual(['/tools']);
	});

	it('lists the family tools and stamps the registry version on the answer', async () => {
		const { client } = makeBackendClient(REGISTRY);
		const tool = new OpsApiGuideTool(makeLogService(), client);

		const body = textOf(await tool.invoke(makeOptions({ action: 'list' as const }), makeToken()));

		expect(body).toContain('**get_bibliography**');
		// Narrowed to the family: a citation tool is not an EPO OPS tool.
		expect(body).not.toContain('search_office_action_citations');
		expect(body).toContain('docs 1.0.0');
		expect(body).toContain('backend 1.4.0+abc1234');
	});

	it('renders one tool\'s usage, parameter guidance, examples and input schema', async () => {
		const { client } = makeBackendClient(REGISTRY);
		const tool = new OpsApiGuideTool(makeLogService(), client);

		const body = textOf(await tool.invoke(
			makeOptions({ action: 'endpoint' as const, endpoint: 'get_bibliography' }), makeToken()));

		expect(body).toContain('## Tool: get_bibliography');
		expect(body).toContain('Start here for title, applicants and dates.');
		expect(body).toContain('patent_number: Publication number, e.g. EP1000000.');
		expect(body).toContain('"patent_number": "EP1000000"');
		expect(body).toContain('### Input Schema');
	});

	it('answers for a tool outside the family rather than denying a tool that exists', async () => {
		const { client } = makeBackendClient(REGISTRY);
		const tool = new OpsApiGuideTool(makeLogService(), client);

		const body = textOf(await tool.invoke(
			makeOptions({ action: 'endpoint' as const, endpoint: 'search_office_action_citations' }), makeToken()));

		expect(body).toContain('## Tool: search_office_action_citations');
	});

	it('reports a name that matches no tool at all', async () => {
		const { client } = makeBackendClient(REGISTRY);
		const tool = new OpsApiGuideTool(makeLogService(), client);

		const body = textOf(await tool.invoke(
			makeOptions({ action: 'endpoint' as const, endpoint: 'get_unicorns' }), makeToken()));

		expect(body).toContain('No tool named "get_unicorns"');
	});

	it('serves the registry recipes as workflows, filtered by name', async () => {
		const { client } = makeBackendClient(REGISTRY);
		const tool = new CitationApiGuideTool(makeLogService(), client);

		const all = textOf(await tool.invoke(makeOptions({ action: 'workflow' as const }), makeToken()));
		const one = textOf(await tool.invoke(makeOptions({ action: 'workflow' as const, workflow: 'novelty' }), makeToken()));
		const missing = textOf(await tool.invoke(makeOptions({ action: 'workflow' as const, workflow: 'nope' }), makeToken()));

		expect(all).toContain('### novelty (search_office_action_citations)');
		expect(one).toContain('"examiner_cited_only": true');
		expect(missing).toContain('No recipe named "nope"');
	});

	it('defers to the typed citation tools instead of teaching the raw reference', async () => {
		const { client } = makeBackendClient(REGISTRY);
		const tool = new CitationApiGuideTool(makeLogService(), client);

		const deferred = textOf(await tool.invoke(
			makeOptions({ action: 'endpoint' as const, endpoint: 'search_office_action_citations' }), makeToken()));
		const listed = textOf(await tool.invoke(makeOptions({ action: 'list' as const }), makeToken()));

		expect(deferred.startsWith('⚠️ STOP')).toBe(true);
		expect(deferred).toContain('`search_citations`');
		expect(listed).toContain('prefer these typed tools');
	});

	it('surfaces a backend failure with the seam\'s recovery hint rather than an empty guide', async () => {
		const { client } = makeBackendClient(() => { throw new PatentBackendError(401, 'expired'); });
		const tool = new OpsApiGuideTool(makeLogService(), client);

		const body = textOf(await tool.invoke(makeOptions({ action: 'list' as const }), makeToken()));

		expect(body).toContain('Failed to fetch EPO OPS tool docs');
		expect(body).toContain('401');
	});
});
