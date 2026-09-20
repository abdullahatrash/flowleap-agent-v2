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
import type { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
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
function backend(metadata: object, images?: object): IPatentBackendClient {
	return new class extends mock<IPatentBackendClient>() {
		override async post<T>(_path: string, body?: unknown): Promise<T> {
			const wantsImages = !!(body as { include_images?: boolean } | undefined)?.include_images;
			if (wantsImages && !images) { throw new Error('Backend refused the image render.'); }
			return { success: true, data: wantsImages ? images : metadata } as T;
		}
	}();
}

function figuresTool(client: IPatentBackendClient, ledger: ReturnType<typeof recordingPatentLedger>['ledger']): GetPatentFiguresTool {
	return new GetPatentFiguresTool(logService(), client, new class extends mock<IFileSystemService>() { }(), new class extends mock<IPromptPathRepresentationService>() { }(), new class extends mock<IWorkspaceService>() { }(), new class extends mock<IInstantiationService>() { }(), ledger);
}

async function invoke(client: IPatentBackendClient, ledger: ReturnType<typeof recordingPatentLedger>['ledger']): Promise<string> {
	const result = await figuresTool(client, ledger).invoke({ input: { publicationNumber: 'EP-1234567-A1' } } as vscode.LanguageModelToolInvocationOptions<{ publicationNumber: string }>, CancellationToken.None);
	return result.content.filter((part): part is LanguageModelTextPart => part instanceof LanguageModelTextPart).map(part => part.value).join('');
}

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
				'\n2 more page(s) available (up to page 6). To view them, call this tool again with the "pages" parameter (e.g. pages="5,6").',
			].join(''),
			executions: [{
				kind: 'figures', status: 'succeeded', publicationIds: ['EP1234567A1'],
				sources: [3, 4].map(page => ({ anchor: `EP1234567A1:figure:${page}`, reference: { publicationNumber: 'EP1234567A1', section: 'bibliography' }, figure: { page }, retrieval: 'returned', review: 'unknown', completeness: 'unknown' })),
			}],
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
