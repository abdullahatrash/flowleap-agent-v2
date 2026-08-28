/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The wire contract of the facade migration (backend PRD 0013 Phase 2, #229): every patent-data tool
 * reaches the backend as `POST /tools/<tool_name>` with snake_case input, and nothing calls a
 * provider route any more.
 *
 * The assertions here are deliberately about the CALL, not the rendering — each tool's own spec
 * covers its output. What would break silently if a tool name or a parameter name drifted is the
 * request, so that is what is pinned.
 */

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { IPromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import type { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import type { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelDataPart, LanguageModelTextPart } from '../../../../vscodeTypes';
import type { IPatentBackendClient, IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { GetPatentDetailsTool } from '../getPatentDetailsTool';
import { GetPatentFiguresTool } from '../getPatentFiguresTool';
import { SearchAcademicTool } from '../searchAcademicTool';
import { SearchLegalTool } from '../searchLegalTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/**
 * A client whose `post` answers each facade tool from a per-tool script, recording the tool name and
 * input it was called with. `get` throws: after the migration nothing reads a provider route.
 */
function makeBackendClient(dataByTool: Record<string, unknown>) {
	const calls: { tool: string; input: unknown; options?: IPatentBackendRequestOptions }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		getTrialModelKey(): never { throw new Error('getTrialModelKey not exercised in this test fake'); },
		async post<T>(path: string, body: unknown, _token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
			const tool = path.replace('/tools/', '');
			calls.push({ tool, input: body, options });
			return { success: true, tool, data: dataByTool[tool], executionTimeMs: 1 } as T;
		},
		async get<T>(pathWithQuery: string): Promise<T> {
			throw new Error(`no patent tool may read a provider route (${pathWithQuery})`);
		},
	};
	return { client, calls };
}

/**
 * File-system, path and instantiation fakes for {@link GetPatentFiguresTool}'s optional `saveDir`
 * path. The instantiation fake skips the workspace-confinement guard (integration behavior); what
 * is pinned here is that pages become PNG files at predictable paths.
 */
function makeFiguresSaveServices() {
	const writes: { path: string; bytes: number }[] = [];
	const fileSystemService = {
		async stat(): Promise<never> { throw new Error('does not exist'); },
		async createDirectory(): Promise<void> { },
		async writeFile(uri: URI, content: Uint8Array): Promise<void> { writes.push({ path: uri.path, bytes: content.length }); },
	} as unknown as IFileSystemService;
	const promptPathRepresentationService = {
		// Like the real service, only absolute paths resolve — relative ones fall back to the workspace.
		resolveFilePath: (filePath: string) => filePath.startsWith('/') ? URI.file(filePath) : undefined,
		getFilePath: (uri: URI) => uri.path,
	} as unknown as IPromptPathRepresentationService;
	const workspaceService = {
		getWorkspaceFolders: () => [URI.file('/ws')],
	} as unknown as IWorkspaceService;
	const instantiationService = {
		invokeFunction: () => Promise.resolve(undefined),
	} as unknown as IInstantiationService;
	return { writes, fileSystemService, promptPathRepresentationService, workspaceService, instantiationService };
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
	return (result.content[0] as LanguageModelTextPart).value;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('get_patent_details', () => {

	it('composes the bibliography, claims and description tools on one publication number', async () => {
		const { client, calls } = makeBackendClient({
			get_bibliography: {
				docId: 'EP1000000A1', title: 'A battery', abstract: 'An abstract.',
				applicants: ['ACME'], inventors: ['Smith'], ipc: ['H01M'], cpc: [],
				dates: { filing: '2018-01-01', publication: '2020-01-01', priority: [] },
			},
			get_claims: {
				docId: 'EP1000000A1',
				claims: [{ number: '1', text: '1. A battery pack.' }],
				totalClaims: 1,
				language: 'en',
			},
			get_description: { docId: 'EP1000000A1', description: 'The description.', language: 'en' },
		});
		const tool = new GetPatentDetailsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP-1000000-A1' }), makeToken());

		expect(calls.map(c => ({ tool: c.tool, input: c.input }))).toEqual([
			{ tool: 'get_bibliography', input: { patent_number: 'EP1000000A1' } },
			{ tool: 'get_claims', input: { patent_number: 'EP1000000A1' } },
			{ tool: 'get_description', input: { patent_number: 'EP1000000A1' } },
		]);
		// The claims tool returns NUMBERED claims; the rendered text is their text, in order.
		expect(textOf(result)).toContain('1. A battery pack.');
		expect(textOf(result)).toContain('The description.');
	});

	it('degrades a missing section to the fallback line instead of failing the whole lookup', async () => {
		const { client } = makeBackendClient({
			get_bibliography: { docId: 'US7654321B2', title: 'A device', abstract: null, applicants: [], inventors: [], ipc: [], cpc: [], dates: { filing: null, publication: null, priority: [] } },
			// get_claims / get_description answer with no data — the facade's soft-failure shape.
		});
		const tool = new GetPatentDetailsTool(makeLogService(), client);

		const body = textOf(await tool.invoke(makeOptions({ publicationNumber: 'US7654321B2' }), makeToken()));

		expect(body).toContain('# Patent: US7654321B2');
		expect(body).toContain('Full text is not available for this document and section.');
		// The fallback names a TOOL, never a retired provider route.
		expect(body).toContain('get_us_grant');
		expect(body).not.toContain('/patent-search-uspto');
	});
});

describe('get_patent_figures', () => {

	/** A client whose `post` answers `get_patent_image` with metadata first, then the images. */
	function makeScriptedImageClient() {
		const { client, calls } = makeBackendClient({});
		const answers = [
			{ docId: 'EP1000000A1', formats: [{ format: 'pdf', pages: 9, link: 'x', drawingStartPage: 7 }] },
			{
				docId: 'EP1000000A1', totalFigures: 9, availableFormats: ['png', 'pdf'], drawingStartPage: 7,
				figures: [
					{ page: 7, format: 'png', description: 'Figure 7', base64: 'aGVsbG8=' },
					{ page: 8, format: 'png', description: 'Figure 8', base64: 'aGVsbG8=' },
				],
			},
		];
		let call = 0;
		const scripted: IPatentBackendClient = {
			...client,
			async post<T>(path: string, body: unknown, _t: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
				calls.push({ tool: path.replace('/tools/', ''), input: body, options });
				return { success: true, tool: 'get_patent_image', data: answers[call++], executionTimeMs: 1 } as T;
			},
		};
		return { scripted, calls };
	}

	function makeFiguresTool(scripted: IPatentBackendClient) {
		const services = makeFiguresSaveServices();
		const tool = new GetPatentFiguresTool(makeLogService(), scripted, services.fileSystemService, services.promptPathRepresentationService, services.workspaceService, services.instantiationService);
		return { tool, writes: services.writes };
	}

	it('reads page metadata, then fetches the drawing pages as base64 PNGs inside the tool envelope', async () => {
		const { scripted, calls } = makeScriptedImageClient();
		const { tool, writes } = makeFiguresTool(scripted);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP1000000A1' }), makeToken());

		expect(calls.map(c => ({ tool: c.tool, input: c.input }))).toEqual([
			{ tool: 'get_patent_image', input: { patent_number: 'EP1000000A1' } },
			{
				tool: 'get_patent_image',
				input: { patent_number: 'EP1000000A1', include_images: true, render: 'png', pages: [7, 8, 9] },
			},
		]);
		// Base64 pages arrive inside the JSON envelope and become inline image parts.
		const images = result.content.filter(part => part instanceof LanguageModelDataPart);
		expect(images).toHaveLength(2);
		expect(textOf(result)).toContain('the drawings begin on page 7');
		// Without `saveDir`, nothing is written to disk.
		expect(writes).toEqual([]);
	});

	it('with saveDir, also writes each page as a PNG file and reports the paths', async () => {
		const { scripted } = makeScriptedImageClient();
		const { tool, writes } = makeFiguresTool(scripted);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP1000000A1', saveDir: '/ws/figures' }), makeToken());

		// 'aGVsbG8=' decodes to the 5 bytes of 'hello'.
		expect(writes).toEqual([
			{ path: '/ws/figures/EP1000000A1-page-7.png', bytes: 5 },
			{ path: '/ws/figures/EP1000000A1-page-8.png', bytes: 5 },
		]);
		const allText = result.content.filter(part => part instanceof LanguageModelTextPart).map(part => part.value).join('\n');
		expect(allText).toContain('Saved 2 PNG file(s)');
		expect(allText).toContain('/ws/figures/EP1000000A1-page-7.png');
	});

	it('resolves a relative saveDir against the workspace folder', async () => {
		const { scripted } = makeScriptedImageClient();
		const { tool, writes } = makeFiguresTool(scripted);

		await tool.invoke(makeOptions({ publicationNumber: 'EP1000000A1', saveDir: 'figures' }), makeToken());

		expect(writes.map(w => w.path)).toEqual([
			'/ws/figures/EP1000000A1-page-7.png',
			'/ws/figures/EP1000000A1-page-8.png',
		]);
	});
});

describe('search_academic', () => {

	it('maps the tool\'s own source spelling onto the facade\'s, with snake_case max_results', async () => {
		const { client, calls } = makeBackendClient({
			search_academic: { total: 1, papers: [{ title: 'A paper', authors: ['Ada'], url: 'https://example.test', source: 'scholar' }] },
		});
		const tool = new SearchAcademicTool(makeLogService(), client);

		await tool.invoke(makeOptions({ query: 'perovskite', sources: ['scholar', 'arxiv'], maxResults: 5 }), makeToken());

		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual(expect.objectContaining({
			tool: 'search_academic',
			input: { query: 'perovskite', sources: ['semantic-scholar', 'arxiv'], max_results: 5 },
		}));
	});
});

describe('search_legal', () => {

	it('calls reference_search, the facade name for legal reference lookup', async () => {
		const { client, calls } = makeBackendClient({
			reference_search: { count: 0, results: [] },
		});
		const tool = new SearchLegalTool(makeLogService(), client);

		await tool.invoke(makeOptions({ query: 'inventive step', jurisdiction: 'EPO' as const }), makeToken());

		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual(expect.objectContaining({
			tool: 'reference_search',
			input: { query: 'inventive step', limit: 10, comprehensive: false, jurisdiction: 'EPO' },
		}));
	});
});
