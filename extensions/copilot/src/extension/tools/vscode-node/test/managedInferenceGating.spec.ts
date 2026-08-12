/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import type { IManagedInferenceConsentService } from '../../../patentai/vscode-node/managedInferenceConsentService';
import type { IPatentBackendClient, IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { AnalyzeClaimTool } from '../analyzeClaimTool';
import { BuildPatentQueryTool } from '../buildPatentQueryTool';
import { BuildUSPTOQueryTool } from '../buildUSPTOQueryTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogService;
}

/** Backend client that records every call, so "was anything transmitted?" is directly assertable. */
function makeBackendClient(postPayload: unknown) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		async post<T>(path: string, body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body });
			return postPayload as T;
		},
		async get<T>(pathWithQuery: string, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path: pathWithQuery });
			return postPayload as T;
		},
	};
	return { client, calls };
}

/** Consent service that answers with a fixed verdict and records the subjects it was asked about. */
function makeConsentService(proceed: boolean) {
	const asked: string[] = [];
	const consentService = {
		async requestConsent(subjectId: string): Promise<boolean> {
			asked.push(subjectId);
			return proceed;
		},
	} as unknown as IManagedInferenceConsentService;
	return { consentService, asked };
}

function makeToken(): CancellationToken {
	return { isCancellationRequested: false, onCancellationRequested() { return { dispose: () => { } }; } };
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function textOf(result: vscode.LanguageModelToolResult): string {
	return (result.content[0] as LanguageModelTextPart).value;
}

// ── Scripted backend payloads ──────────────────────────────────────────────────

const QUERY_STRATEGY = {
	success: true,
	strategy: {
		recommended_cql: 'ti=("solar cell")',
		explanation: 'Title search on the core term.',
		search_fields_used: ['ti'],
	},
};

const USPTO_STRATEGY = {
	success: true,
	strategy: {
		recommended_query: { q: 'inventionTitle:(solar cell)' },
		explanation: 'Title search on the core term.',
		search_parameters_used: ['inventionTitle'],
	},
};

const CLAIM_ANALYSIS = {
	success: true,
	analysis: {
		keywords: ['solar cell'],
		synonyms: { 'solar cell': ['photovoltaic cell'] },
		ipcCodes: ['H01L 31/00'],
		suggestedQueries: ['ti=("solar cell")'],
		claimElements: [{ element: 'A photovoltaic device comprising', type: 'preamble' }],
	},
};

/** The three gated tools, each with the subject it must ask about and a scripted success payload. */
const GATED_TOOLS = [
	{
		name: 'BuildPatentQueryTool',
		subject: 'query-generation',
		path: '/build-patent-query',
		build: (log: ILogService, client: IPatentBackendClient, consent: IManagedInferenceConsentService) => new BuildPatentQueryTool(log, client, consent),
		payload: QUERY_STRATEGY,
		input: { description: 'A flexible photovoltaic device.' },
	},
	{
		name: 'BuildUSPTOQueryTool',
		subject: 'query-generation',
		path: '/build-uspto-query',
		build: (log: ILogService, client: IPatentBackendClient, consent: IManagedInferenceConsentService) => new BuildUSPTOQueryTool(log, client, consent),
		payload: USPTO_STRATEGY,
		input: { description: 'A flexible photovoltaic device.' },
	},
	{
		name: 'AnalyzeClaimTool',
		subject: 'claim-analysis',
		path: '/analyze-claim',
		build: (log: ILogService, client: IPatentBackendClient, consent: IManagedInferenceConsentService) => new AnalyzeClaimTool(log, client, consent),
		payload: CLAIM_ANALYSIS,
		input: { claimText: 'A photovoltaic device comprising a light-absorbing layer.' },
	},
] as const;

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('managed-inference consent gating', () => {

	describe.each(GATED_TOOLS)('$name', ({ subject, path, build, payload, input }) => {

		it('asks about its subject and calls the backend once consent is given', async () => {
			const { client, calls } = makeBackendClient(payload);
			const { consentService, asked } = makeConsentService(true);

			const result = await build(makeLogService(), client, consentService).invoke(makeOptions(input) as never, makeToken());

			expect({ asked, paths: calls.map(c => c.path) }).toEqual({ asked: [subject], paths: [path] });
			// The provenance line keeps the disclosure visible after the one-time prompt.
			expect(textOf(result)).toContain('via FlowLeap-managed inference');
		});

		it('sends nothing at all when the user has refused', async () => {
			const { client, calls } = makeBackendClient(payload);
			const { consentService, asked } = makeConsentService(false);

			const result = await build(makeLogService(), client, consentService).invoke(makeOptions(input) as never, makeToken());

			// The guarantee: no verdict, no transmission. The backend must not be reached at all.
			expect({ asked, calls }).toEqual({ asked: [subject], calls: [] });
			expect(textOf(result)).toContain('user-action stop, not a dead route');
		});

		it('reports a refusal as a tool result rather than throwing', async () => {
			const { client } = makeBackendClient(payload);
			const { consentService } = makeConsentService(false);

			// A throw would surface as a tool error the agent may retry; a result carries the
			// doctrine text telling it not to.
			await expect(
				build(makeLogService(), client, consentService).invoke(makeOptions(input) as never, makeToken())
			).resolves.toBeDefined();
		});
	});

	it('gates the claim-analysis tool before it even validates its input', async () => {
		const { client, calls } = makeBackendClient(CLAIM_ANALYSIS);
		const { consentService, asked } = makeConsentService(false);

		const result = await new AnalyzeClaimTool(makeLogService(), client, consentService)
			.invoke(makeOptions({ claimText: '' }), makeToken());

		// Consent is the first question, so a refusing user is told about their own setting
		// rather than getting a validation error that leaks nothing about why nothing happened.
		expect({ asked, calls }).toEqual({ asked: ['claim-analysis'], calls: [] });
		expect(textOf(result)).toContain('Claim Analysis is turned off');
	});
});
