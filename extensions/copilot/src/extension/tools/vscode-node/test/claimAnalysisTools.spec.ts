/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import type { IPatentBackendClient, IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { AnalyzeClaimTool } from '../analyzeClaimTool';
import { CompareClaimsTool } from '../compareClaimsTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/**
 * A {@link IPatentBackendClient} whose `post`/`get` return scripted payloads, capturing the paths
 * and bodies they were called with so the test can assert the tool routes through the shared
 * client seam.
 */
function makeBackendClient(postPayload?: unknown, getPayload?: unknown) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async post<T>(path: string, body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body });
			return postPayload as T;
		},
		async get<T>(pathWithQuery: string, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path: pathWithQuery });
			return getPayload as T;
		},
	};
	return { client, calls };
}

/** Stub CancellationToken that is never cancelled. */
function makeToken(): CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested() {
			return { dispose: () => { /* noop */ } };
		},
	};
}

/** Minimal invocation options — the tools only read `options.input`. */
function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

/** Read the single text part produced by a tool invocation. */
function textOf(result: vscode.LanguageModelToolResult): string {
	const part = result.content[0];
	return (part as LanguageModelTextPart).value;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('claim-analysis tools', () => {

	it('AnalyzeClaimTool POSTs /analyze-claim and renders structured markdown', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			analysis: {
				keywords: ['solar cell', 'photovoltaic'],
				synonyms: { 'solar cell': ['PV cell', 'photovoltaic cell'] },
				ipcCodes: ['H01L 31/00'],
				suggestedQueries: ['ti=("solar cell") and ic=H01L'],
				claimElements: [
					{ element: 'A photovoltaic device comprising', type: 'preamble' },
					{ element: 'a light-absorbing layer', type: 'component' },
				],
			},
		});
		const tool = new AnalyzeClaimTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ claimText: 'A photovoltaic device comprising a light-absorbing layer.' }), makeToken());

		expect(calls).toEqual([{ path: '/analyze-claim', body: { claimText: 'A photovoltaic device comprising a light-absorbing layer.', focus: 'full' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"## Claim Analysis

			### Keywords
			- solar cell
			- photovoltaic

			### Synonyms & Alternative Terms
			- **solar cell**: PV cell, photovoltaic cell

			### Suggested IPC/CPC Classifications
			- H01L 31/00

			### Recommended Search Queries (CQL)
			1. \`ti=("solar cell") and ic=H01L\`

			### Claim Elements
			1. **[preamble]** A photovoltaic device comprising
			2. **[component]** a light-absorbing layer

			---
			Use the suggested CQL queries with the \`search_patents\` tool to find prior art.
			Run multiple queries to maximize coverage (different terminology may find different patents)."
		`);
	});

	it('CompareClaimsTool GETs /ops/fulltext/claims per patent and renders the comparison package', async () => {
		const { client, calls } = makeBackendClient(undefined, {
			success: true,
			data: {
				docId: 'US7654321B2',
				lang: 'en',
				claims: ['1. A photovoltaic module comprising a rigid substrate and a light-absorbing layer.'],
			},
		});
		const tool = new CompareClaimsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ userClaim: 'A flexible photovoltaic device.', patentNumbers: ['US-7654321-B2'] }), makeToken());

		expect(calls).toEqual([{ path: '/ops/fulltext/claims?doc=US7654321B2' }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"## Prior Art Claim Comparison Package

			### User Claim
			\`\`\`
			A flexible photovoltaic device.
			\`\`\`

			### Prior Art Claims

			#### US-7654321-B2
			\`\`\`
			1. A photovoltaic module comprising a rigid substrate and a light-absorbing layer.
			\`\`\`

			---
			### Analysis Instructions
			Now perform an element-by-element comparison of the user claim against each prior-art claim set above. For each patent, report:
			1. **Relevance** — HIGH (anticipates most/all elements), MEDIUM (discloses several elements), or LOW.
			2. **Overlapping elements** — user-claim elements disclosed by the prior art, citing the specific claim number.
			3. **Missing elements** — user-claim elements NOT found in the prior art (potential novelty).
			4. **Key differences** — material differences in scope or implementation.

			Then summarize: HIGH-relevance patents raise §102 (anticipation) risk; combinations of MEDIUM-relevance patents may support §103 (obviousness) rejections. Use get_patent_details for full descriptions of specific patents if needed."
		`);
	});
});
