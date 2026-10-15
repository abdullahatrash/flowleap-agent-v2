/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import type { IPromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import type { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import type { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelDataPart, LanguageModelTextPart } from '../../../../vscodeTypes';
import type { IPatentBackendClient } from '../../../patentai/vscode-node/patentBackendClient';
import { GetPatentFiguresTool } from '../getPatentFiguresTool';
import { recordingPatentLedger } from './patentLedgerTestUtils';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));
vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

/** One transparent PNG pixel, base64, so the tool has a real image to decode. */
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function logService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/** The two `get_patent_image` calls the tool makes: metadata first, then the selected pages. */
function backend(metadata: object, images?: object, requests: unknown[] = []): IPatentBackendClient {
	return new class extends mock<IPatentBackendClient>() {
		override async post<T>(_path: string, body?: unknown): Promise<T> {
			requests.push(body);
			const wantsImages = !!(body as { include_images?: boolean } | undefined)?.include_images;
			if (wantsImages && !images) { throw new Error('Backend refused the image render.'); }
			return { success: true, data: wantsImages ? images : metadata } as T;
		}
	}();
}

function figuresTool(client: IPatentBackendClient, ledger: ReturnType<typeof recordingPatentLedger>['ledger']): GetPatentFiguresTool {
	return new GetPatentFiguresTool(logService(), client, new class extends mock<IFileSystemService>() { }(), new class extends mock<IPromptPathRepresentationService>() { }(), new class extends mock<IWorkspaceService>() { }(), new class extends mock<IInstantiationService>() { }(), ledger);
}

/** The same tool inside a workspace at `/work`, whose writes are collected instead of performed. */
function savingTool(client: IPatentBackendClient, ledger: ReturnType<typeof recordingPatentLedger>['ledger'], written: string[]): GetPatentFiguresTool {
	const fileSystem = new class extends mock<IFileSystemService>() {
		override stat(): Promise<never> { return Promise.reject(new Error('No such directory.')); }
		override createDirectory(): Promise<void> { return Promise.resolve(); }
		override writeFile(uri: URI): Promise<void> { written.push(uri.path); return Promise.resolve(); }
	}();
	const paths = new class extends mock<IPromptPathRepresentationService>() {
		// The tool documents a relative saveDir, which this service resolves for absolute paths only.
		override resolveFilePath(filePath: string): URI | undefined { return filePath.startsWith('/') ? URI.file(filePath) : undefined; }
		override getFilePath(uri: URI): string { return uri.path; }
	}();
	const workspace = new class extends mock<IWorkspaceService>() {
		override getWorkspaceFolders(): URI[] { return [URI.file('/work')]; }
	}();
	const instantiation = new class extends mock<IInstantiationService>() {
		override invokeFunction(): never { return undefined as never; }
	}();
	return new GetPatentFiguresTool(logService(), client, fileSystem, paths, workspace, instantiation, ledger);
}

async function invoke(client: IPatentBackendClient, ledger: ReturnType<typeof recordingPatentLedger>['ledger'], pages?: string): Promise<string> {
	const result = await figuresTool(client, ledger).invoke({ input: { publicationNumber: 'EP-1234567-A1', ...(pages ? { pages } : {}) } } as vscode.LanguageModelToolInvocationOptions<{ publicationNumber: string; pages?: string }>, CancellationToken.None);
	return result.content.filter((part): part is LanguageModelTextPart => part instanceof LanguageModelTextPart).map(part => part.value).join('');
}

/** The trailing note of a result: what the model is told to fetch next. */
async function trailingNote(client: IPatentBackendClient, pages?: string): Promise<string | undefined> {
	const text = await invoke(client, recordingPatentLedger().ledger, pages);
	return text.split('\n').pop();
}

describe('GetPatentFiguresTool page selection', () => {
	it('asks for the DRAWINGS pages EPO reports as compact renders, and names the search report page', async () => {
		const requests: unknown[] = [];
		const metadata = {
			docId: 'EP4671722', totalFigures: 12, drawingStartPage: 9, drawingPages: [9, 10],
			sections: { ABSTRACT: 1, BIBLIOGRAPHY: 1, DESCRIPTION: 2, CLAIMS: 7, DRAWINGS: 9, SEARCH_REPORT: 11 },
			formats: [{ format: 'pdf', pages: 12, drawingStartPage: 9 }],
		};
		const images = { docId: 'EP4671722', figures: [{ page: 9, format: 'png', base64: pixel }, { page: 10, format: 'png', base64: pixel }], truncated: false, remainingPages: [] };
		const text = await invoke(backend(metadata, images, requests), recordingPatentLedger().ledger);
		expect({ requests, header: text.split('\n')[0], note: text.split('\n').pop() }).toEqual({
			requests: [
				{ patent_number: 'EP-1234567-A1' },
				{ patent_number: 'EP-1234567-A1', include_images: true, fit: 'compact', pages: [9, 10] },
			],
			header: 'Patent EP4671722 has 12 page(s); the drawings begin on page 9. The search report starts on page 11 and is not a drawing. Showing drawing pages 9\u201310:',
			note: 'To cite a drawing in a coverage row, give the element this anchor and a short reading of what the figure clearly shows; never a dimension or ratio unless the drawing is stated to be to scale.',
		});
	});

	it('takes the first eight drawing pages and names the rest when EPO reports more', async () => {
		const requests: unknown[] = [];
		const drawingPages = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
		const metadata = { docId: 'EP1234567A1', totalFigures: 20, drawingPages, sections: { DRAWINGS: 9, SEARCH_REPORT: 19 }, formats: [{ format: 'pdf', pages: 20, drawingStartPage: 9 }] };
		const images = { docId: 'EP1234567A1', figures: drawingPages.slice(0, 8).map(page => ({ page, format: 'png', base64: pixel })), truncated: false, remainingPages: [] };
		const note = await trailingNote(backend(metadata, images, requests));
		expect({ pages: (requests[1] as { pages: number[] }).pages, note }).toEqual({
			pages: [9, 10, 11, 12, 13, 14, 15, 16],
			note: '2 more page(s) available (17\u201318). To view them, call this tool again with the "pages" parameter (e.g. pages="17,18").',
		});
	});

	it('falls back to drawingStartPage..end when the inquiry reports no drawing pages', async () => {
		const requests: unknown[] = [];
		const metadata = { docId: 'EP1234567A1', totalFigures: 6, drawingStartPage: 3, drawingPages: [], sections: {}, formats: [{ format: 'pdf', pages: 6, drawingStartPage: 3 }] };
		const images = { docId: 'EP1234567A1', figures: [3, 4, 5, 6].map(page => ({ page, format: 'png', base64: pixel })) };
		const text = await invoke(backend(metadata, images, requests), recordingPatentLedger().ledger);
		expect({ pages: (requests[1] as { pages: number[] }).pages, header: text.split('\n')[0] }).toEqual({
			pages: [3, 4, 5, 6],
			header: 'Patent EP1234567A1 has 6 page(s); the drawings begin on page 3. Showing drawing pages 3\u20136:',
		});
	});
});

describe('GetPatentFiguresTool page formats', () => {
	it('gives a jpeg page a jpeg image part and skips a page it cannot show inline', async () => {
		const { ledger } = recordingPatentLedger();
		const client = backend(
			{ docId: 'EP1234567A1', formats: [{ format: 'pdf', pages: 4, drawingStartPage: 3 }], drawingPages: [3, 4] },
			{ docId: 'EP1234567A1', figures: [{ page: 3, format: 'png', base64: pixel }, { page: 4, format: 'jpeg', base64: pixel }, { page: 5, format: 'tiff', base64: pixel }] },
		);
		const result = await figuresTool(client, ledger).invoke({ input: { publicationNumber: 'EP1234567A1' } } as vscode.LanguageModelToolInvocationOptions<{ publicationNumber: string }>, CancellationToken.None);
		const images = result.content.filter((part): part is LanguageModelDataPart => part instanceof LanguageModelDataPart).map(part => part.mimeType);
		const text = result.content.filter((part): part is LanguageModelTextPart => part instanceof LanguageModelTextPart).map(part => part.value).join('');
		expect({ images, skipped: text.split('\n').find(line => line.startsWith('Page(s)')) }).toEqual({
			images: ['image/png', 'image/jpeg'],
			skipped: 'Page(s) 5 came back as tiff and cannot be shown inline.',
		});
	});

	it('names the pages the size budget left out, for a default and for a requested selection', async () => {
		const metadata = { docId: 'EP1234567A1', totalFigures: 12, drawingPages: [9, 10, 11, 12], formats: [{ format: 'pdf', pages: 12, drawingStartPage: 9 }] };
		const images = { docId: 'EP1234567A1', figures: [{ page: 9, format: 'png', base64: pixel }], truncated: true, remainingPages: [10, 11, 12] };
		expect({ byDefault: await trailingNote(backend(metadata, images)), requested: await trailingNote(backend(metadata, images), '9,10,11,12') }).toEqual({
			byDefault: 'The response reached its size budget, so page(s) 10\u201312 were not returned. To view them, call this tool again with pages="10,11,12".',
			requested: 'The response reached its size budget, so page(s) 10\u201312 were not returned. To view them, call this tool again with pages="10,11,12".',
		});
	});
});

describe('GetPatentFiguresTool evidence record', () => {
	it('records one source per returned page and prints the anchor the model must cite', async () => {
		const { ledger, executions } = recordingPatentLedger();
		const client = backend(
			{ docId: 'EP1234567A1', formats: [{ format: 'pdf', pages: 6, drawingStartPage: 3 }] },
			{ docId: 'EP1234567A1', figures: [{ page: 3, format: 'png', base64: pixel }, { page: 4, format: 'png', base64: pixel }] },
		);
		expect({ text: await invoke(client, ledger), executions }).toEqual({
			text: [
				'Patent EP1234567A1 has 6 page(s); the drawings begin on page 3. Showing drawing pages 3\u20134:',
				'\nPage 3:', 'Anchor: EP1234567A1:figure:3',
				'\nPage 4:', 'Anchor: EP1234567A1:figure:4',
				'\nTo cite a drawing in a coverage row, give the element this anchor and a short reading of what the figure clearly shows; never a dimension or ratio unless the drawing is stated to be to scale.',
				'\n2 more page(s) available (5\u20136). To view them, call this tool again with the "pages" parameter (e.g. pages="5,6").',
			].join(''),
			executions: [{
				kind: 'figures', status: 'succeeded', publicationIds: ['EP1234567A1'],
				sources: [3, 4].map(page => ({ anchor: `EP1234567A1:figure:${page}`, reference: { publicationNumber: 'EP1234567A1', section: 'bibliography' }, figure: { page }, retrieval: 'returned', review: 'unknown', completeness: 'unknown' })),
			}],
		});
	});

	it('records the workspace-relative file each page was saved to, with the extension of its format', async () => {
		const client = backend(
			{ docId: 'EP1964767A2', formats: [{ format: 'pdf', pages: 4, drawingStartPage: 3 }] },
			{ docId: 'EP1964767A2', figures: [{ page: 3, format: 'png', base64: pixel }, { page: 4, format: 'jpeg', base64: pixel }] },
		);
		const run = async (saveDir: string): Promise<unknown> => {
			const { ledger, executions } = recordingPatentLedger();
			const written: string[] = [];
			const result = await savingTool(client, ledger, written).invoke({ input: { publicationNumber: 'EP1964767A2', saveDir } } as vscode.LanguageModelToolInvocationOptions<{ publicationNumber: string; saveDir: string }>, CancellationToken.None);
			const text = result.content.filter((part): part is LanguageModelTextPart => part instanceof LanguageModelTextPart).map(part => part.value).join('');
			return { written, figures: executions[0].sources?.map(source => source.figure), saved: text.split('\n').slice(-3) };
		};
		expect({ nested: await run('references/figures'), flat: await run('figures') }).toEqual({
			nested: {
				written: ['/work/references/figures/EP1964767A2-page-3.png', '/work/references/figures/EP1964767A2-page-4.jpg'],
				figures: [{ page: 3, file: 'references/figures/EP1964767A2-page-3.png' }, { page: 4, file: 'references/figures/EP1964767A2-page-4.jpg' }],
				saved: ['Saved 2 image file(s):', '- /work/references/figures/EP1964767A2-page-3.png', '- /work/references/figures/EP1964767A2-page-4.jpg'],
			},
			flat: {
				written: ['/work/figures/EP1964767A2-page-3.png', '/work/figures/EP1964767A2-page-4.jpg'],
				figures: [{ page: 3, file: 'figures/EP1964767A2-page-3.png' }, { page: 4, file: 'figures/EP1964767A2-page-4.jpg' }],
				saved: ['Saved 2 image file(s):', '- /work/figures/EP1964767A2-page-3.png', '- /work/figures/EP1964767A2-page-4.jpg'],
			},
		});
	});

	it('records a failed figures outcome when the render cannot be fetched', async () => {
		const { ledger, executions } = recordingPatentLedger();
		const text = await invoke(backend({ docId: 'EP1234567A1', formats: [{ format: 'pdf', pages: 6, drawingStartPage: 3 }] }), ledger);
		expect({ message: text, executions }).toEqual({
			message: 'Error: Backend refused the image render.',
			executions: [{ kind: 'figures', status: 'failed', publicationIds: ['EP1234567A1'] }],
		});
	});
});

describe('GetPatentFiguresTool save confirmation', () => {
	it('asks before a save outside every workspace folder and not before one inside the project', async () => {
		const { ledger } = recordingPatentLedger();
		const tool = savingTool(backend({ docId: 'EP1964767A2' }), ledger, []);
		const confirmation = async (saveDir: string): Promise<string | undefined> => {
			const prepared = await tool.prepareInvocation({ input: { publicationNumber: 'EP1964767A2', saveDir } } as vscode.LanguageModelToolInvocationPrepareOptions<{ publicationNumber: string; saveDir: string }>, CancellationToken.None);
			return prepared?.confirmationMessages?.message as string | undefined;
		};
		expect({ inside: await confirmation('references/figures'), outside: await confirmation('/tmp/x') }).toEqual({
			inside: undefined,
			outside: 'Allow Patent AI to save the figure images of EP1964767A2 into /tmp/x?',
		});
	});
});
