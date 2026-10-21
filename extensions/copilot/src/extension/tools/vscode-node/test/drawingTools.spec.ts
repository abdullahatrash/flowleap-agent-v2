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
import { DraftingEditors, forgetRefusals } from '../draftingWorkspace';
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
	// Each test is one matter in a fresh chat: no refusal of an earlier test counts as repeated.
	forgetRefusals();
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
	// The editors of the window, as a fake: the tests have no window to reveal the checklist in.
	const editors = new class implements DraftingEditors {
		readonly visible = new Set<string>();
		isVisible(uri: URI): boolean { return this.visible.has(uri.path); }
		async showBeside(uri: URI): Promise<void> { this.visible.add(uri.path); }
	}();
	class TestRenderFigureTool extends RenderFigureTool {
		protected override editors(): DraftingEditors { return editors; }
		protected override today(): string { return '2026-10-19'; }
	}
	class TestBuildDrawingSetTool extends BuildDrawingSetTool { protected override editors(): DraftingEditors { return editors; } }
	class TestProposeFigurePartTool extends ProposeFigurePartTool { protected override editors(): DraftingEditors { return editors; } }
	const render = new TestRenderFigureTool(fileSystem, workspace, instantiation);
	const build = new TestBuildDrawingSetTool(fileSystem, workspace, instantiation);
	const propose = new TestProposeFigurePartTool(fileSystem, workspace, instantiation);
	type RenderInput = Parameters<RenderFigureTool['invoke']>[0]['input'];
	type ProposeInput = Parameters<ProposeFigurePartTool['invoke']>[0]['input'];
	const tools = {
		render: async (input: Omit<RenderInput, 'matter'>, chatVariables = new ChatVariablesCollection()) => {
			const resolved = await render.resolveInput({ matter: 'hinge', ...input }, { query: '', history: [], chatVariables });
			return parts(render.invoke({ input: resolved, toolInvocationToken: undefined }, CancellationToken.None));
		},
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
	const confirmation = async (input: Omit<RenderInput, 'matter'>) => (await render.prepareInvocation({ input: { matter: 'hinge', ...input } } as vscode.LanguageModelToolInvocationPrepareOptions<RenderInput>, CancellationToken.None)).confirmationMessages?.message;
	return { fileSystem, tools, read, exists, list, write, confirmation };
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
			noHeading: { text: 'The Figure was not rendered. drafting/hinge/figures.md has no heading for FIG. 3 (`## FIG. 3` with its parts). Add the Figure and its parts to the figure list first. Open in drafting/hinge/checklist.md: step 2 (Approve the claims). Next: Review `drafting/hinge/claims.md:2`: it changed after the approval on line 2. The next drafting step changes `true` to `false` there; then click **Approve Claims** at the top of the file, or change `false` to `true`. Stay in this chat.', images: [] },
			staleApproval: 'The Figure was not rendered. A flowchart from a claim needs the Approved Claims. drafting/hinge/claims.md changed after it was approved, so the approval was withdrawn. Review `drafting/hinge/claims.md:2`, then click **Approve Claims** at the top of the file, or change `false` to `true` on line 2. Then start_application_draft and a new save start the next draft version. Open in drafting/hinge/checklist.md: step 2 (Approve the claims). Stay in this chat.',
			claimsCleared: '\napproved: false\n',
		});
	});

	it('says to start a new chat after the same refusal twice for the same Figure (PRD 0026 S2)', async () => {
		const { tools } = setup();
		const ending = (text: string) => text.slice(text.lastIndexOf('. ') + 2);
		const first = ending((await tools.render({ figure: 3, scene })).text);
		const second = ending((await tools.render({ figure: 3, scene })).text);
		expect({ first, second }).toEqual({ first: 'Stay in this chat.', second: 'Start a new chat: the agent refused the same step twice.' });
	});

	it('attaches the review render only when the model sees it, and records the round', async () => {
		const { tools, read } = setup();
		const seen = await tools.render({ figure: 2, flowchart: { fromClaim: 2 } });
		const unseen = await tools.render({ figure: 2, flowchart: { fromClaim: 2 }, includeRender: false });
		expect({
			seen: seen.images,
			unseen: unseen.images,
			rounds: JSON.parse(await read('drafting/hinge/drawings/rounds.json')).figures['2'].rounds.map((round: { seen: boolean }) => round.seen),
		}).toEqual({ seen: ['image/png'], unseen: [], rounds: [true, false] });
	}, KERNEL_TIMEOUT);
	it('rewrites the Drafting Checklist after the render, with the drawn Figures counted', async () => {
		const { tools, read, write } = setup();
		await write('drafting/hinge/checklist.md', 'stale');
		const result = await tools.render({ figure: 2, flowchart: { fromClaim: 2 } });
		expect({
			last: result.text.split('\n').at(-1),
			figures: (await read('drafting/hinge/checklist.md')).split('\n').filter(line => line.startsWith('- Figures:')),
		}).toEqual({
			last: 'Wrote drafting/hinge/checklist.md: the next step for the attorney is step 3 (Write the outline). Next: Tell the agent: "Plan the draft again" (it saves draft-outline.md with write_patent_results, template draft-outline). Stay in this chat.',
			figures: ['- Figures: 2 in figures.md, 1 drawn in drawings/'],
		});
	}, KERNEL_TIMEOUT);

	it('copies every image attached to the turn to sketches/, named by figure and date, and copies nothing when the bytes are there already', async () => {
		const { tools, list, fileSystem } = setup();
		const napkin = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
		const photo = new Uint8Array([255, 216, 255, 4, 5]);
		const attached = new ChatVariablesCollection([
			{ id: 'vscode.image', name: 'napkin sketch.png', value: new ChatReferenceBinaryData('image/png', async () => napkin) },
			{ id: 'vscode.image', name: 'photo', value: new ChatReferenceBinaryData('image/jpeg', async () => photo) },
		]);
		const first = await tools.render({ figure: 2, flowchart: { fromClaim: 2 }, includeRender: false }, attached);
		const second = await tools.render({ figure: 2, flowchart: { fromClaim: 2 }, includeRender: false }, attached);
		expect({
			first: first.text.split('\n').filter(line => line.startsWith('Copied')),
			second: second.text.split('\n').filter(line => line.startsWith('Copied')),
			sketches: await list('drafting/hinge/sketches'),
			photo: [...await fileSystem.readFile(URI.file('/workspace/drafting/hinge/sketches/FIG-2-2026-10-19-2.jpg'))],
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);

	it('asks the attorney to confirm a new review cycle, also the fourth one, and asks nothing for a normal round', async () => {
		const { confirmation, write } = setup();
		const rounds = (cycle: number) => write('drafting/hinge/drawings/rounds.json', JSON.stringify({ figures: { '2': { cycle, rounds: [{ round: 1, png: 'review/FIG-2.round-1.png', seen: true }] } } }));
		const noRound = await confirmation({ figure: 2, newCycle: true });
		await rounds(1);
		const plain = await confirmation({ figure: 2 });
		const second = await confirmation({ figure: 2, newCycle: true });
		await rounds(3);
		const fourth = await confirmation({ figure: 2, newCycle: true });
		expect({ noRound, plain, second, fourth }).toEqual({
			noRound: 'Start review cycle 1 for FIG. 2? Three more rounds.',
			plain: undefined,
			second: 'Start review cycle 2 for FIG. 2? Three more rounds.',
			fourth: 'Start review cycle 4 for FIG. 2? Three more rounds.',
		});
	});
});

describe('build_drawing_set tool', () => {
	it('prefixes a refusal, writes the Drafting Checklist and ends with its open steps', async () => {
		const { tools, read } = setup();
		expect({
			text: await tools.build(),
			figures: (await read('drafting/hinge/checklist.md')).split('\n').filter(line => line.startsWith('- Figures:')),
		}).toEqual({
			text: 'The Drawing Set was not built. drafting/hinge/drawings/ has no Figure (FIG-N.svg). Render each Figure with render_figure first. Open in drafting/hinge/checklist.md: step 3 (Write the outline). Next: Tell the agent: "Plan the draft again" (it saves draft-outline.md with write_patent_results, template draft-outline). Stay in this chat.',
			figures: ['- Figures: 2 in figures.md'],
		});
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
