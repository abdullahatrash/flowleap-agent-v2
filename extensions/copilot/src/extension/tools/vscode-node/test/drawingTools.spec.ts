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

describe('render_figure', () => {
	it('refuses a Figure without a heading in figures.md, and writes nothing', async () => {
		const { tools, list } = setup();
		expect({ result: await tools.render({ figure: 3, scene }), drawings: await list('drafting/hinge/drawings') }).toEqual({
			result: { text: 'The Figure was not rendered. drafting/hinge/figures.md has no heading for FIG. 3 (`## FIG. 3` with its parts). Add the Figure and its parts to the figure list first.', images: [] },
			drawings: [],
		});
	});

	it('refuses a numeral that figures.md does not list', async () => {
		const { tools } = setup();
		const result = await tools.render({ figure: 1, scene: { ...scene, numerals: [...scene.numerals, { numeral: '14', part: 'housing', face: 'top' }] } });
		expect(result.text).toBe('The Figure was not rendered. Every part drawn has a numeral, and every numeral is in the figure list:\n- Error `numeral-not-allowed` (FIG-1.scene.json): Numeral 14 is not in the figures list (allowed: 10, 12, 2, 4, 6). [37 CFR 1.84(p)(5); OJ EPO 2025 A49 Art. 1(2)(i); PCT Rule 11.13(l)]\nAdd the part to the figure list (propose_figure_part when the disclosure does not state it), or remove it from the scene.');
	});

	it('refuses a part without a numeral', async () => {
		const { tools } = setup();
		const result = await tools.render({ figure: 1, scene: { ...scene, parts: [...scene.parts, { id: 'lid', shape: { kind: 'box', size: [10, 10, 2] } }] } });
		expect(result.text).toMatchSnapshot();
	});

	it('refuses 2D numerals that are not under the Figure heading, listing the lines to add', async () => {
		const { tools } = setup();
		const result = await tools.render({ figure: 2, flowchart: { steps: ['measure the temperature', 'compare it with a limit', 'open the valve', 'close the valve'] } });
		expect(result.text).toMatchSnapshot();
	});

	it('refuses a fourth round', async () => {
		const { tools, write, list } = setup();
		for (const round of [1, 2, 3]) {
			await write(`drafting/hinge/drawings/review/FIG-1.round-${round}.png`, 'png');
		}
		expect({ result: (await tools.render({ figure: 1, scene })).text, review: await list('drafting/hinge/drawings/review') }).toEqual({
			result: 'The Figure was not rendered. FIG. 1 already had 3 review rounds; the limit is 3 per Figure. Edit drafting/hinge/drawings/FIG-1.scene.json by hand, or ask the attorney.',
			review: ['FIG-1.round-1.png', 'FIG-1.round-2.png', 'FIG-1.round-3.png'],
		});
	});

	it('renders a 3D scene: writes the source, the SVG and the review render, returns the render with the findings, and records the round', async () => {
		const { tools, read, list, fileSystem } = setup();
		const first = await tools.render({ figure: 1, scene });
		const second = await tools.render({ figure: 1, scene, includeRender: false });
		const png = await fileSystem.readFile(URI.file('/workspace/drafting/hinge/drawings/review/FIG-1.round-2.png'));
		expect({
			first,
			second,
			drawings: await list('drafting/hinge/drawings'),
			review: await list('drafting/hinge/drawings/review'),
			pngSignature: [...png.slice(1, 4)].map(code => String.fromCharCode(code)).join(''),
			sourceFigure: JSON.parse(await read('drafting/hinge/drawings/FIG-1.scene.json')).figure,
			svgStart: (await read('drafting/hinge/drawings/FIG-1.svg')).slice(0, 4),
			rounds: JSON.parse(await read('drafting/hinge/drawings/rounds.json')),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);

	it('renders a flowchart from an approved method claim', async () => {
		const { tools, read } = setup();
		const result = await tools.render({ figure: 2, flowchart: { fromClaim: 2 } });
		expect({ result, source: JSON.parse(await read('drafting/hinge/drawings/FIG-2.scene.json')) }).toMatchSnapshot();
	}, KERNEL_TIMEOUT);
});

describe('build_drawing_set', () => {
	it('refuses with no Figure, on a proposed part, on a figure-list Error and on a coverage gap', async () => {
		const noFigure = await setup().tools.build();
		const withFigure = async (files: Record<string, string>) => {
			const run = setup({ ...matter, ...files });
			await run.write('drafting/hinge/drawings/FIG-1.svg', '<svg/>');
			return run.tools.build();
		};
		expect({
			noFigure,
			proposed: await withFigure({ 'drafting/hinge/figures.md': `${figures}- 8: spring (proposed from sketches/sketch-1.png)\n` }),
			epoLetter: await withFigure({ 'drafting/hinge/feature-list.md': featureList.replace('office: US', 'office: EPO'), 'drafting/hinge/figures.md': figures.replace('numerals: even', 'numerals: even\npageSize: letter') }),
			coverageGap: await withFigure({ 'drafting/hinge/figures.md': figures.replace('- 10: housing [F1]', '- 10: housing') }),
		}).toMatchSnapshot();
	});

	it('lays out the Figures, writes the sheets, the PDF and the receipt, and updates the Filing Manifest', async () => {
		const { tools, read, list, write, fileSystem } = setup();
		await tools.render({ figure: 1, scene });
		await tools.render({ figure: 2, flowchart: { fromClaim: 2 }, includeRender: false });
		await write('drafting/hinge/draft-application.md', '---\noffice: US\n---\n# Housing\n\n## DETAILED DESCRIPTION\n\nThe housing 10 has a top face 12.\n\n## CLAIMS\n\n1. A housing comprising a top face.\n\n## ABSTRACT\n\nA housing.\n');
		await write('drafting/hinge/filing-manifest.md', 'old manifest');
		await write('drafting/hinge/drawings/sheet-9.svg', '<svg/>');
		const result = await tools.build();
		const pdf = Buffer.from(await fileSystem.readFile(URI.file('/workspace/drafting/hinge/drawings/drawings.pdf'))).toString('latin1');
		expect({
			result,
			drawings: await list('drafting/hinge/drawings'),
			review: await list('drafting/hinge/drawings/review'),
			pdfHeader: pdf.slice(0, 8),
			receipt: (await read('drafting/hinge/drawings/drawings-compliance.md')).replace(/\d{4}-\d\d-\d\d/, '<date>'),
			manifestSheets: (await read('drafting/hinge/filing-manifest.md')).split('\n').filter(line => /drawing sheets/i.test(line)),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);
});

describe('propose_figure_part', () => {
	it('refuses a numeral already used, a numeral outside the scheme and a sketch it cannot find', async () => {
		const { tools, read } = setup();
		expect({
			used: await tools.propose({ figure: 1, part: 'lid', numeral: '12' }),
			odd: await tools.propose({ figure: 1, part: 'lid', numeral: '13' }),
			hundreds: await setup({ ...matter, 'drafting/hinge/figures.md': figures.replace('numerals: even', 'numerals: hundreds') }).tools.propose({ figure: 1, part: 'lid', numeral: '204' }),
			noSketch: await tools.propose({ figure: 1, part: 'lid', sketch: 'napkin.png' }),
			figuresUnchanged: await read('drafting/hinge/figures.md') === figures,
		}).toEqual({
			used: 'No part was proposed. Numeral 12 is already used for "top face" (drafting/hinge/figures.md, line 7). One numeral names one part.',
			odd: 'No part was proposed. Numeral 13 is odd; figures.md uses `numerals: even`.',
			hundreds: 'No part was proposed. Numeral 204 does not start with 1; figures.md uses `numerals: hundreds`, so a part first drawn in FIG. 1 takes 102 to 198.',
			noSketch: 'No part was proposed. "napkin.png" is neither an image attached in this chat (none is attached) nor an image file in the workspace.',
			figuresUnchanged: true,
		});
	});

	it('appends a proposed line with the next numeral and copies the attached sketch to sketches/', async () => {
		const { tools, read, fileSystem } = setup();
		const sketch = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
		const attached = new ChatVariablesCollection([{ id: 'vscode.image', name: 'bracket sketch.png', value: new ChatReferenceBinaryData('image/png', async () => sketch) }]);
		const result = await tools.propose({ figure: 1, part: 'bracket', features: ['f1'], sketch: 'bracket sketch.png' }, attached);
		const again = await tools.propose({ figure: 3, part: 'spring', sketch: 'drafting/hinge/sketches/bracket-sketch.png' });
		expect({
			result,
			again,
			figures: await read('drafting/hinge/figures.md'),
			sketch: [...await fileSystem.readFile(URI.file('/workspace/drafting/hinge/sketches/bracket-sketch.png'))],
		}).toMatchSnapshot();
	});
});
