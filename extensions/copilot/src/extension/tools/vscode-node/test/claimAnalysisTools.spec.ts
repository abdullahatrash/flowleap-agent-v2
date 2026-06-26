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
 * A {@link IPatentBackendClient} whose `post` returns a scripted payload, capturing the path and body
 * it was called with so the test can assert the tool routes through the shared client seam.
 */
function makeBackendClient(payload: unknown) {
	const calls: { path: string; body: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async post<T>(path: string, body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body });
			return payload as T;
		},
		get<T>(): Promise<T> {
			throw new Error('get not used by claim-analysis tools');
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

	it('CompareClaimsTool POSTs /compare-claims and renders structured markdown', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			summary: 'One highly relevant prior art reference found.',
			comparisons: [
				{
					patentNumber: 'US-7654321-B2',
					title: 'Photovoltaic module',
					relevanceScore: 'HIGH',
					overlappingElements: ['light-absorbing layer'],
					missingElements: ['flexible substrate'],
					keyDifferences: ['Prior art uses a rigid substrate'],
					analysis: 'Strong overlap on the absorber stack.',
				},
			],
		});
		const tool = new CompareClaimsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ userClaim: 'A flexible photovoltaic device.', patentNumbers: ['US-7654321-B2'] }), makeToken());

		expect(calls).toEqual([{ path: '/compare-claims', body: { userClaim: 'A flexible photovoltaic device.', patentNumbers: ['US-7654321-B2'] } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"## Prior Art Comparison Results

			### Summary
			One highly relevant prior art reference found.

			### Detailed Comparisons

			#### US-7654321-B2
			**Title:** Photovoltaic module
			**Relevance:** 🔴 HIGH

			**Overlapping Elements:**
			- ✓ light-absorbing layer

			**Elements NOT in Prior Art:**
			- ✗ flexible substrate

			**Key Differences:**
			- Prior art uses a rigid substrate

			**Analysis:**
			Strong overlap on the absorber stack.

			---

			### Next Steps
			- **HIGH relevance patents** should be carefully reviewed for 102 (anticipation) issues
			- **MEDIUM relevance patents** may be combined for 103 (obviousness) rejections
			- Use \`get_patent_details\` to view full claims of specific patents
			- Consider searching for additional prior art if coverage is low"
		`);
	});
});
