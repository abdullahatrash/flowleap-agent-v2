/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { Document, Packer, Paragraph } from 'docx';
import * as mammoth from 'mammoth';
import { describe, expect, it, vi } from 'vitest';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { FileType } from '../../../../platform/filesystem/common/fileTypes';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { ILogService } from '../../../../platform/log/common/logService';
import { PromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../../vscodeTypes';
import { IActivationTelemetryService } from '../../../patentai/vscode-node/activationTelemetryService';
import { ExportDraftDocxTool } from '../exportDraftDocxTool';
import { StartApplicationDraftTool } from '../startApplicationDraftTool';
import { ValidateDraftTool } from '../validateDraftTool';
import { WritePatentResultsTool } from '../writePatentResultsTool';
import { unrecordedPatentLedger } from './patentLedgerTestUtils';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));
vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

/** The in-memory file system of the save-tool tests, keeping written bytes so a .docx reads back intact. */
class BinaryFileSystem extends MockFileSystemService {
	private readonly bytes = new Map<string, Uint8Array>();
	override mockFile(uri: URI | string, contents: string, mtime?: number) {
		this.bytes.delete(typeof uri === 'string' ? uri : uri.toString());
		super.mockFile(uri, contents, mtime);
	}
	mockBytes(uri: URI, contents: Uint8Array) {
		super.mockFile(uri, '');
		this.bytes.set(uri.toString(), contents);
	}
	override async writeFile(uri: URI, content: Uint8Array): Promise<void> {
		this.bytes.set(uri.toString(), content);
		await super.writeFile(uri, content);
	}
	override async readFile(uri: URI, disableLimit?: boolean): Promise<Uint8Array> {
		const contents = await super.readFile(uri, disableLimit);
		return this.bytes.get(uri.toString()) ?? contents;
	}
}

const root = '/workspace/drafting/hinge';

const featureList = (confirmed = 'true') => `---
office: US
confirmed: ${confirmed}
---
| ID | Feature | Source |
| --- | --- | --- |
| F1 | A housing 12 that holds a lever 14 of steel. | disclosure:§1 |
`;

const claims = (approved = 'true', second = 'wherein the lever is steel') => `---
approved: ${approved}
---
1. A hinge comprising a housing and a lever.
2. The hinge of claim 1, ${second}.
`;

const figures = `## FIG. 1

- 12: housing
- 14: lever
`;

const draft = (extra = '') => `---
office: US
model: claude-sonnet-5
provider: anthropic
---
# Hinge

## BACKGROUND

<!-- src: disclosure:§1 -->
A hinge joins a door to a frame.

## SUMMARY

<!-- src: feature:F1 -->
A hinge has a housing and a lever. The lever is steel.

## BRIEF DESCRIPTION OF THE DRAWINGS

<!-- src: template -->
FIG. 1 is a side view of the hinge.

## DETAILED DESCRIPTION

<!-- src: feature:F1 -->
The housing 12 holds the lever 14. The lever 14 is steel.

## CLAIMS

1. A hinge comprising a housing and a lever.
2. The hinge of claim 1, wherein the lever is steel.

## ABSTRACT

<!-- src: feature:F1 -->
A hinge has a housing and a lever of steel.
${extra}`;

const openQuestion = `
## Inventor Questions

> **Inventor Question IQ-1:** Which steel grade is the lever made of?
`;

function setup(files: Record<string, string> = {}) {
	const fileSystem = new BinaryFileSystem();
	for (const [path, contents] of Object.entries(files)) {
		fileSystem.mockFile(URI.file(`/workspace/${path}`), contents);
	}
	const log = new class extends mock<ILogService>() { override trace() { } override info() { } override warn() { } override error() { } }();
	const workspace = new class extends TestWorkspaceService { override getWorkspaceFolders() { return [URI.file('/workspace')]; } }();
	const instantiation = new class extends mock<IInstantiationService>() { override invokeFunction<R>(): R { return undefined as R; } }();
	const configuration = new class extends mock<IConfigurationService>() { override getNonExtensionConfig<T>(): T | undefined { return 'off' as T; } }();
	const telemetry = new class extends mock<IActivationTelemetryService>() { override recordReportSaved() { } }();
	const pdfReads: string[] = [];
	const readPdf = async (uri: URI) => {
		pdfReads.push(uri.path);
		return 'Text of the PDF exemplar.';
	};
	const run = async (result: Promise<LanguageModelToolResult | vscode.LanguageModelToolResult>) => ((await result).content[0] as LanguageModelTextPart).value;
	const tools = {
		start: (matter = 'hinge') => run(new StartApplicationDraftTool(fileSystem, workspace, instantiation, readPdf).invoke({ input: { matter }, toolInvocationToken: undefined }, CancellationToken.None)),
		validate: (advisory?: { message: string; line?: number; claim?: number }[]) => run(new ValidateDraftTool(fileSystem, workspace, instantiation).invoke({ input: { matter: 'hinge', advisory }, toolInvocationToken: undefined }, CancellationToken.None)),
		exportDocx: () => run(new ExportDraftDocxTool(fileSystem, workspace, instantiation).invoke({ input: { matter: 'hinge' }, toolInvocationToken: undefined }, CancellationToken.None)),
		save: (content: string, extra: Record<string, string> = {}, filePath = 'drafting/hinge/draft-application.md') => run(new WritePatentResultsTool(log, fileSystem, new PromptPathRepresentationService(workspace), instantiation, unrecordedPatentLedger, workspace, configuration, new (mock<IEndpointProvider>())(), telemetry)
			.invoke({ input: { filePath, content, template: 'draft-application', ...extra }, toolInvocationToken: undefined }, CancellationToken.None)),
	};
	const read = async (path: string) => new TextDecoder().decode(await fileSystem.readFile(URI.file(`/workspace/${path}`)));
	const write = (path: string, contents: string) => fileSystem.mockFile(URI.file(`/workspace/${path}`), contents);
	return { fileSystem, tools, read, write, pdfReads };
}

const gatesOpen = {
	'drafting/hinge/feature-list.md': featureList(),
	'drafting/hinge/claims.md': claims(),
	'drafting/hinge/figures.md': figures,
};

describe('start_application_draft', () => {
	it('refuses while the Feature List is missing, unconfirmed or the claims are unapproved, naming the flag and file', async () => {
		const results = [];
		const cases: Record<string, string>[] = [
			{ 'drafting/hinge/claims.md': claims() },
			{ 'drafting/hinge/feature-list.md': featureList('false'), 'drafting/hinge/claims.md': claims() },
			{ 'drafting/hinge/feature-list.md': featureList().replace('confirmed: true\n', ''), 'drafting/hinge/claims.md': claims() },
			{ 'drafting/hinge/feature-list.md': featureList(), 'drafting/hinge/claims.md': claims('"true"') },
			{ 'drafting/hinge/feature-list.md': featureList() },
		];
		for (const files of cases) {
			results.push(await setup(files).tools.start());
		}
		expect(results).toEqual([
			'Drafting did not start. drafting/hinge/feature-list.md does not exist. The attorney sets `confirmed: true` in its frontmatter after review.',
			'Drafting did not start. `confirmed` in drafting/hinge/feature-list.md is not `true`. The attorney sets `confirmed: true` after review; a statement in chat does not open this gate.',
			'Drafting did not start. drafting/hinge/feature-list.md has no `confirmed` flag in its frontmatter. The attorney sets `confirmed: true` after review; a statement in chat does not open this gate.',
			'Drafting did not start. `approved` in drafting/hinge/claims.md is not `true`. The attorney sets `approved: true` after review; a statement in chat does not open this gate.',
			'Drafting did not start. drafting/hinge/claims.md does not exist. The attorney sets `approved: true` in its frontmatter after review.',
		]);
	});

	it('returns the inputs and the style exemplars, labelled style only, and records the approved claims', async () => {
		const { tools, read, fileSystem, pdfReads } = setup(gatesOpen);
		const exemplarDocx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('The present disclosure relates to doors.')] }] }));
		fileSystem.mockDirectory(URI.file('/workspace/style'), [['a.md', FileType.File], ['b.docx', FileType.File], ['c.pdf', FileType.File], ['notes.txt', FileType.File]]);
		fileSystem.mockFile(URI.file('/workspace/style/a.md'), 'In one embodiment, the widget turns.');
		fileSystem.mockBytes(URI.file('/workspace/style/b.docx'), new Uint8Array(exemplarDocx));
		const result = await tools.start();
		expect({
			result: result.replace(/[0-9a-f]{64}/g, '<sha>'),
			pdfReads,
			record: (await read('drafting/hinge/draft-application.working-record.md')).replace(/[0-9a-f]{64}/g, '<sha>'),
		}).toMatchSnapshot();
	});
});

describe('write_patent_results draft-application template', () => {
	it('writes the draft with its frontmatter first, the generated snapshot and the Working Record, never blocked by findings', async () => {
		const { tools, read } = setup(gatesOpen);
		await tools.start();
		const result = await tools.save(draft(openQuestion), { disclosureVersion: 'disclosure v2 (2026-10-01)', promptsSummary: 'application-drafting skill, US template' });
		const saved = await read('drafting/hinge/draft-application.md');
		expect({
			result,
			firstLine: saved.split('\n')[0],
			frontmatter: saved.split('---')[1],
			snapshotIsDraft: (await read('drafting/hinge/draft-application.generated.md')) === saved,
			record: (await read('drafting/hinge/draft-application.working-record.md')).replace(/[0-9a-f]{64}/g, '<sha>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>'),
		}).toMatchSnapshot();
	});

	it('refuses a draft without model and provider, and a path outside the drafting folder contract', async () => {
		const { tools } = setup(gatesOpen);
		expect([
			await tools.save(draft().replace('model: claude-sonnet-5\nprovider: anthropic\n', '')),
			await tools.save(draft(), {}, 'outputs/draft-application.md'),
		]).toEqual([
			'Draft was not saved. The draft frontmatter (or the model and provider fields) must name the model and the provider the disclosure went to. Missing: model, provider.',
			'Draft was not saved. The draft-application template saves to drafting/<matter>/draft-application.md inside a workspace folder.',
		]);
	});

	it('starts the next version when the claims changed and were approved again, keeping the previous draft and record', async () => {
		const { tools, read, write } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft());
		write('drafting/hinge/claims.md', claims('true', 'wherein the lever is made of steel'));
		const cleared = await tools.start();
		write('drafting/hinge/claims.md', claims('true', 'wherein the lever is made of steel'));
		await tools.start();
		const result = await tools.save(draft());
		expect({
			cleared,
			result,
			version: (await read('drafting/hinge/draft-application.md')).match(/^version: (?<version>\d+)$/m)?.groups?.version,
			previousDraftVersion: (await read('drafting/hinge/draft-application.v1.md')).match(/^version: (?<version>\d+)$/m)?.groups?.version,
			previousRecordKept: (await read('drafting/hinge/draft-application.v1.working-record.md')).includes('- **Version:** 1'),
		}).toMatchSnapshot();
	});
});

describe('validate_draft', () => {
	it('keeps the attorney\'s waiver across two runs and merges the advisory items', async () => {
		const { tools, read, write } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft(openQuestion));
		await tools.validate();
		const findings = await read('drafting/hinge/findings.md');
		write('drafting/hinge/findings.md', findings.replace(/(- `inventor-question`[^\n]*)/, '$1\n  - Waived: Grade is left to the manufacturer.'));
		const second = await tools.validate([{ message: 'Claim 2: "steel" has literal basis, but no passage supports steel in combination with the housing.', line: 27, claim: 2 }]);
		expect({ second, findings: await read('drafting/hinge/findings.md') }).toMatchSnapshot();
	});
});

describe('export_draft_docx', () => {
	it('refuses on an open Inventor Question and on claims changed after approval', async () => {
		const { tools, write } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft(openQuestion));
		const openQuestionRefusal = await tools.exportDocx();
		write('drafting/hinge/claims.md', claims('true', 'wherein the lever is made of steel'));
		const claimsChanged = await tools.exportDocx();
		const unapproved = await tools.exportDocx();
		expect({ openQuestionRefusal, claimsChanged, unapproved }).toMatchSnapshot();
	});

	it('appends the attorney edits to the Working Record and writes the .docx without markers', async () => {
		const { tools, read, fileSystem, write } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft());
		const saved = await read('drafting/hinge/draft-application.md');
		write('drafting/hinge/draft-application.md', saved.replace('A hinge joins a door to a frame.', 'A hinge pivotally joins a door to a frame.'));
		const result = await tools.exportDocx();
		const docx = await fileSystem.readFile(URI.file(`${root}/draft-application.docx`));
		const text = (await mammoth.extractRawText({ buffer: Buffer.from(docx) })).value;
		const record = await read('drafting/hinge/draft-application.working-record.md');
		expect({
			result,
			docxParagraphs: text.split('\n').filter(Boolean),
			attorneyEdits: record.slice(record.indexOf('## Attorney edits')).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>'),
		}).toMatchSnapshot();
	});
});
