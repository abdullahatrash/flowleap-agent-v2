/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { IIgnoreService, NullIgnoreService } from '../../../../platform/ignore/common/ignoreService';
import { IPromptPathRepresentationService, PromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService, ServiceIdentifier, ServicesAccessor } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { ChatReferenceBinaryData, LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult } from '../../../../vscodeTypes';
import type { DrawingScene } from '../../../drawings/common/scene/drawingScene';
import { ChatVariablesCollection } from '../../../prompt/common/chatVariablesCollection';
import { BuildDrawingSetTool } from '../buildDrawingSetTool';
import { ProposeFigurePartTool } from '../proposeFigurePartTool';
import { RenderFigureTool } from '../renderFigureTool';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));

/** The in-memory file system, keeping written bytes so a PNG or PDF reads back intact. */
class BinaryFileSystem extends MockFileSystemService {
	private readonly bytes = new Map<string, Uint8Array>();
	override async writeFile(uri: URI, content: Uint8Array): Promise<void> {
		this.bytes.set(uri.toString(), content);
		await super.writeFile(uri, content);
	}
	override async readFile(uri: URI, disableLimit?: boolean): Promise<Uint8Array> {
		const contents = await super.readFile(uri, disableLimit);
		return this.bytes.get(uri.toString()) ?? contents;
	}
	override async delete(uri: URI): Promise<void> {
		this.bytes.delete(uri.toString());
		await super.delete(uri);
	}
}

const KERNEL_TIMEOUT = 60_000;

const scene: DrawingScene = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../drawings/node/kernel/test/fixtures/box-two-numerals.scene.json'), 'utf8'));

const featureList = `---
office: US
confirmed: true
---
| ID | Feature | Source |
| --- | --- | --- |
| F1 | A housing 10 with a top face 12. | disclosure:§1 |
| F2 | Measuring and comparing a temperature. | disclosure:§2 |
`;

const claims = `---
approved: true
---
1. A housing comprising a top face.
2. A method of cooling a battery pack, comprising: measuring a cell temperature with a sensor; comparing the cell temperature with a limit; and opening a coolant valve when the cell temperature exceeds the limit.
`;

const figures = `---
numerals: even
---
## FIG. 1

- 10: housing [F1]
- 12: top face

## FIG. 2

- 2: measuring a cell temperature [F2]
- 4: comparing the cell temperature
- 6: opening a coolant valve
`;

const outline = `---
office: US
claims: 0
---
# Draft Outline

| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |
|------|---------|------|--------|-------------|---------|---------|----------|
| O1 | DETAILED DESCRIPTION | Technical | 1 | a housing | F1, FIG. 1 | yes |  |
`;

const matter = {
	'drafting/hinge/feature-list.md': featureList,
	'drafting/hinge/claims.md': claims,
	'drafting/hinge/figures.md': figures,
	'drafting/hinge/draft-outline.md': outline,
};

function setup(files: Record<string, string> = matter) {
	const fileSystem = new BinaryFileSystem();
	for (const [file, contents] of Object.entries(files)) {
		fileSystem.mockFile(URI.file(`/workspace/${file}`), contents);
	}
	const workspace = new class extends TestWorkspaceService { override getWorkspaceFolders() { return [URI.file('/workspace')]; } }();
	const services = new Map<unknown, unknown>([[IIgnoreService, new NullIgnoreService()], [IWorkspaceService, workspace], [IPromptPathRepresentationService, new PromptPathRepresentationService(workspace)]]);
	const accessor: ServicesAccessor = { get: <T>(id: ServiceIdentifier<T>) => (services.get(id) ?? {}) as T };
	const instantiation = new class extends mock<IInstantiationService>() {
		override invokeFunction<R, TS extends unknown[] = []>(fn: (accessor: ServicesAccessor, ...args: TS) => R, ...args: TS): R { return fn(accessor, ...args); }
	}();
	const parts = async (result: Promise<LanguageModelToolResult | vscode.LanguageModelToolResult>) => {
		const content = (await result).content;
		return { text: (content[0] as LanguageModelTextPart).value, images: content.filter(part => part instanceof LanguageModelDataPart).map(part => (part as LanguageModelDataPart).mimeType) };
	};
	const render = new RenderFigureTool(fileSystem, workspace, instantiation);
	const build = new BuildDrawingSetTool(fileSystem, workspace, instantiation);
	const propose = new ProposeFigurePartTool(fileSystem, workspace, instantiation);
	type RenderInput = Parameters<RenderFigureTool['invoke']>[0]['input'];
	type ProposeInput = Parameters<ProposeFigurePartTool['invoke']>[0]['input'];
	const tools = {
		render: (input: Omit<RenderInput, 'matter'>) => parts(render.invoke({ input: { matter: 'hinge', ...input }, toolInvocationToken: undefined }, CancellationToken.None)),
		build: async () => (await parts(build.invoke({ input: { matter: 'hinge' }, toolInvocationToken: undefined }, CancellationToken.None))).text,
		propose: async (input: Omit<ProposeInput, 'matter'>, chatVariables = new ChatVariablesCollection()) => {
			const resolved = await propose.resolveInput({ matter: 'hinge', ...input }, { query: '', history: [], chatVariables });
			return (await parts(propose.invoke({ input: resolved, toolInvocationToken: undefined }, CancellationToken.None))).text;
		},
	};
	const read = async (file: string) => new TextDecoder().decode(await fileSystem.readFile(URI.file(`/workspace/${file}`)));
	const exists = (file: string) => fileSystem.stat(URI.file(`/workspace/${file}`)).then(() => true, () => false);
	const list = async (folder: string) => (await fileSystem.readDirectory(URI.file(`/workspace/${folder}`))).map(([name]) => name).sort();
	const write = (file: string, contents: string) => fileSystem.writeFile(URI.file(`/workspace/${file}`), new TextEncoder().encode(contents));
	return { fileSystem, tools, read, exists, list, write };
}

describe('render_figure tool', () => {
	it('prefixes a refusal, and checks the Approved Claims with the drafting gate', async () => {
		const stale = `---\napproved: true\napprovedHash: 0000\n---\n${claims.split('---\n')[2]}`;
		const { tools, read } = setup({ ...matter, 'drafting/hinge/claims.md': stale });
		expect({
			noHeading: await tools.render({ figure: 3, scene }),
			staleApproval: (await tools.render({ figure: 2, flowchart: { fromClaim: 2 } })).text,
			claimsCleared: (await read('drafting/hinge/claims.md')).split('---')[1],
		}).toEqual({
			noHeading: { text: 'The Figure was not rendered. drafting/hinge/figures.md has no heading for FIG. 3 (`## FIG. 3` with its parts). Add the Figure and its parts to the figure list first.', images: [] },
			staleApproval: 'The Figure was not rendered. A flowchart from a claim needs the Approved Claims. drafting/hinge/claims.md changed after it was approved, so `approved` was set to `false`. The attorney reviews the claims and sets `approved: true` again; then start_application_draft and a new save start the next draft version.',
			claimsCleared: '\napproved: false\n',
		});
	});

	it('attaches the review render only when the model sees it, and records the round', async () => {
		const { tools, read } = setup();
		const seen = await tools.render({ figure: 2, flowchart: { fromClaim: 2 } });
		const unseen = await tools.render({ figure: 2, flowchart: { fromClaim: 2 }, includeRender: false });
		expect({
			seen: seen.images,
			unseen: unseen.images,
			rounds: JSON.parse(await read('drafting/hinge/drawings/rounds.json')).figures['2'].map((round: { seen: boolean }) => round.seen),
		}).toEqual({ seen: ['image/png'], unseen: [], rounds: [true, false] });
	}, KERNEL_TIMEOUT);
});

describe('build_drawing_set tool', () => {
	it('prefixes a refusal', async () => {
		expect(await setup().tools.build()).toBe('The Drawing Set was not built. drafting/hinge/drawings/ has no Figure (FIG-N.svg). Render each Figure with render_figure first.');
	});
});

describe('propose_figure_part tool', () => {
	it('copies an image attached in chat, or a workspace image, to sketches/', async () => {
		const { tools, read, fileSystem, write } = setup();
		const sketch = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
		await write('photos/clip.png', 'clip');
		const attached = new ChatVariablesCollection([{ id: 'vscode.image', name: 'bracket sketch.png', value: new ChatReferenceBinaryData('image/png', async () => sketch) }]);
		expect({
			attached: await tools.propose({ figure: 1, part: 'bracket', sketch: 'bracket sketch.png' }, attached),
			workspace: await tools.propose({ figure: 1, part: 'clip', sketch: 'photos/clip.png' }),
			notFound: await tools.propose({ figure: 1, part: 'lid', sketch: 'napkin.png' }, attached),
			figures: (await read('drafting/hinge/figures.md')).split('\n').filter(line => line.includes('proposed')),
			sketch: [...await fileSystem.readFile(URI.file('/workspace/drafting/hinge/sketches/bracket-sketch.png'))],
		}).toMatchSnapshot();
	});
});
