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
import { IIgnoreService, NullIgnoreService } from '../../../../platform/ignore/common/ignoreService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IPromptPathRepresentationService, PromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService, ServiceIdentifier, ServicesAccessor } from '../../../../util/vs/platform/instantiation/common/instantiation';
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

const twoQuestions = `
## Inventor Questions

> **Inventor Question IQ-1:** Which steel grade is the lever made of?
> Belongs: Detailed Description, after the paragraph on the housing 12.

> **Inventor Question IQ-2:** How thick is the lever?
`;

/** The draft after the agent applied the answer to IQ-1: the answer at its place with its marker, the question deleted. */
const appliedIq1 = (questions = '\n## Inventor Questions\n\n> **Inventor Question IQ-2:** How thick is the lever?\n') => draft(questions).replace(
	'The housing 12 holds the lever 14. The lever 14 is steel.\n',
	'The housing 12 holds the lever 14. The lever 14 is steel.\n\n<!-- src: inventor:IQ-1 -->\nThe lever 14 is stainless steel.\n');

/** Fills the answer slot of one question in inventor-answers.md, the way the attorney or the inventor does. */
const fillAnswer = (answers: string, id: string, answer: string) => answers.replace(new RegExp(`(## ${id}\\n[\\s\\S]*?\\*\\*Answer:\\*\\*\\n)`), `$1${answer}\n`);

function setup(files: Record<string, string> = {}) {
	const fileSystem = new BinaryFileSystem();
	for (const [path, contents] of Object.entries(files)) {
		fileSystem.mockFile(URI.file(`/workspace/${path}`), contents);
	}
	const log = new class extends mock<ILogService>() { override trace() { } override info() { } override warn() { } override error() { } }();
	const workspace = new class extends TestWorkspaceService { override getWorkspaceFolders() { return [URI.file('/workspace')]; } }();
	// The file guard of every drafting read and write runs for real: `assertFileOkForTool` reads the
	// ignore service, then passes any file inside the workspace folder.
	const ignored = new Set<string>();
	const ignoreService = new class extends NullIgnoreService { override async isCopilotIgnored(file: URI) { return ignored.has(file.path); } }();
	const services = new Map<unknown, unknown>([[IIgnoreService, ignoreService], [IWorkspaceService, workspace], [IPromptPathRepresentationService, new PromptPathRepresentationService(workspace)]]);
	const accessor: ServicesAccessor = { get: <T>(id: ServiceIdentifier<T>) => (services.get(id) ?? {}) as T };
	const instantiation = new class extends mock<IInstantiationService>() {
		override invokeFunction<R, TS extends unknown[] = []>(fn: (accessor: ServicesAccessor, ...args: TS) => R, ...args: TS): R { return fn(accessor, ...args); }
	}();
	const configuration = new class extends mock<IConfigurationService>() { override getNonExtensionConfig<T>(): T | undefined { return 'off' as T; } }();
	const telemetry = new class extends mock<IActivationTelemetryService>() { override recordReportSaved() { } }();
	const pdfReads: string[] = [];
	class TestStartApplicationDraftTool extends StartApplicationDraftTool {
		protected override async readPdf(uri: URI): Promise<string> {
			pdfReads.push(uri.path);
			return 'Text of the PDF exemplar.';
		}
	}
	const run = async (result: Promise<LanguageModelToolResult | vscode.LanguageModelToolResult>) => ((await result).content[0] as LanguageModelTextPart).value;
	const tools = {
		start: (matter = 'hinge') => run(new TestStartApplicationDraftTool(fileSystem, workspace, instantiation).invoke({ input: { matter }, toolInvocationToken: undefined }, CancellationToken.None)),
		validate: (advisory?: { message: string; line?: number; claim?: number }[], matter = 'hinge') => run(new ValidateDraftTool(fileSystem, workspace, instantiation).invoke({ input: { matter, advisory }, toolInvocationToken: undefined }, CancellationToken.None)),
		exportDocx: () => run(new ExportDraftDocxTool(fileSystem, workspace, instantiation).invoke({ input: { matter: 'hinge' }, toolInvocationToken: undefined }, CancellationToken.None)),
		save: (content: string, extra: Record<string, string> = {}, filePath = 'drafting/hinge/draft-application.md') => run(new WritePatentResultsTool(log, fileSystem, new PromptPathRepresentationService(workspace), instantiation, unrecordedPatentLedger, workspace, configuration, new (mock<IEndpointProvider>())(), telemetry)
			.invoke({ input: { filePath, content, template: 'draft-application', ...extra }, toolInvocationToken: undefined }, CancellationToken.None)),
	};
	const read = async (path: string) => new TextDecoder().decode(await fileSystem.readFile(URI.file(`/workspace/${path}`)));
	const write = (path: string, contents: string) => fileSystem.mockFile(URI.file(`/workspace/${path}`), contents);
	/** Changes a file the way an edit in the editor does: the rest of the file, frontmatter included, stays. */
	const edit = async (path: string, from: string, to: string) => write(path, (await read(path)).replace(from, to));
	return { fileSystem, tools, read, write, edit, pdfReads, ignored };
}

/** The frontmatter block of a drafting file, with hashes replaced. */
const frontmatterOf = (text: string) => text.split('---')[1].replace(/[0-9a-f]{64}/g, '<sha>');

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
			'Drafting did not start. drafting/hinge/feature-list.md does not exist. The attorney sets `confirmed: true` in its frontmatter after review. Open in drafting/hinge/checklist.md: step 1 (Confirm the Feature List).',
			'Drafting did not start. `confirmed` in drafting/hinge/feature-list.md is not `true`. The attorney sets `confirmed: true` after review; a statement in chat does not open this gate. Open in drafting/hinge/checklist.md: step 1 (Confirm the Feature List).',
			'Drafting did not start. drafting/hinge/feature-list.md has no `confirmed` flag in its frontmatter. The attorney sets `confirmed: true` after review; a statement in chat does not open this gate. Open in drafting/hinge/checklist.md: step 1 (Confirm the Feature List).',
			'Drafting did not start. `approved` in drafting/hinge/claims.md is not `true`. The attorney sets `approved: true` after review; a statement in chat does not open this gate. Open in drafting/hinge/checklist.md: step 2 (Approve the claims).',
			'Drafting did not start. drafting/hinge/claims.md does not exist. The attorney sets `approved: true` in its frontmatter after review. Open in drafting/hinge/checklist.md: step 2 (Approve the claims).',
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

	it('clears an approval the claims no longer match, and accepts a fresh re-approval and an untouched approval', async () => {
		const forgot = setup(gatesOpen);
		await forgot.tools.start();
		await forgot.edit('drafting/hinge/claims.md', 'wherein the lever is steel', 'wherein the lever is made of steel');
		const forgotResult = await forgot.tools.start();

		const reapproved = setup(gatesOpen);
		await reapproved.tools.start();
		await reapproved.edit('drafting/hinge/claims.md', 'wherein the lever is steel', 'wherein the lever is made of steel');
		await reapproved.tools.start();
		await reapproved.edit('drafting/hinge/claims.md', 'approved: false', 'approved: true');
		const reapprovedResult = await reapproved.tools.start();

		const untouched = setup(gatesOpen);
		await untouched.tools.start();
		const untouchedResult = await untouched.tools.start();

		const outcome = async (run: ReturnType<typeof setup>, result: string) => ({
			result: result.split('.')[0],
			claims: frontmatterOf(await run.read('drafting/hinge/claims.md')),
			approvalCleared: (await run.read('drafting/hinge/draft-application.working-record.md')).includes('- **Approval cleared:**'),
		});
		expect({
			forgot: await outcome(forgot, forgotResult),
			reapproved: await outcome(reapproved, reapprovedResult),
			untouched: await outcome(untouched, untouchedResult),
		}).toEqual({
			forgot: { result: 'Drafting did not start', claims: '\napproved: false\n', approvalCleared: true },
			reapproved: { result: 'Drafting started for matter "hinge"', claims: '\napproved: true\napprovedHash: <sha>\n', approvalCleared: true },
			untouched: { result: 'Drafting started for matter "hinge"', claims: '\napproved: true\napprovedHash: <sha>\n', approvalCleared: false },
		});
	});

	it('reads no drafting file the file guard refuses', async () => {
		const { tools, ignored } = setup(gatesOpen);
		ignored.add('/workspace/drafting/hinge/claims.md');
		await expect(tools.start()).rejects.toThrow('drafting/hinge/claims.md is configured to be ignored by Copilot');
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
			'Draft was not saved. The draft frontmatter (or the model and provider fields) must name the model and the provider the disclosure went to. Missing: model, provider. Open in drafting/hinge/checklist.md: step 3 (Write the draft).',
			'Draft was not saved. The draft-application template saves to drafting/<matter>/draft-application.md inside a workspace folder.',
		]);
	});

	it('refuses the save while the Feature List is unconfirmed or the claims are unapproved, naming the flag and file', async () => {
		expect([
			await setup({ ...gatesOpen, 'drafting/hinge/feature-list.md': featureList('false') }).tools.save(draft()),
			await setup({ ...gatesOpen, 'drafting/hinge/claims.md': claims('false') }).tools.save(draft()),
		]).toEqual([
			'Draft was not saved. `confirmed` in drafting/hinge/feature-list.md is not `true`. The attorney sets `confirmed: true` after review; a statement in chat does not open this gate. Open in drafting/hinge/checklist.md: step 1 (Confirm the Feature List).',
			'Draft was not saved. `approved` in drafting/hinge/claims.md is not `true`. The attorney sets `approved: true` after review; a statement in chat does not open this gate. Open in drafting/hinge/checklist.md: step 2 (Approve the claims).',
		]);
	});

	it('a later save of the same version keeps the generated snapshot, so the export still shows the attorney edit', async () => {
		const { tools, read } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft());
		const snapshot = await read('drafting/hinge/draft-application.generated.md');
		const resaved = await tools.save(draft().replace('A hinge joins a door to a frame.', 'A hinge pivotally joins a door to a frame.'));
		await tools.exportDocx();
		const record = await read('drafting/hinge/draft-application.working-record.md');
		expect({
			resaved: resaved.split('\n')[0],
			snapshotKept: (await read('drafting/hinge/draft-application.generated.md')) === snapshot,
			resavedLine: /^- \*\*Re-saved:\*\* \S+$/m.test(record),
			sourceMapRefreshed: record.includes('| disclosure:§1 | A hinge pivotally joins a door to a frame. |'),
			attorneyEdit: record.slice(record.indexOf('## Attorney edits')).includes('> A hinge pivotally joins a door to a frame.'),
		}).toEqual({
			resaved: 'Saved drafting/hinge/draft-application.md (version 1, office US). Generated snapshot: drafting/hinge/draft-application.generated.md (kept from the first save of version 1). Working record: drafting/hinge/draft-application.working-record.md.',
			snapshotKept: true,
			resavedLine: true,
			sourceMapRefreshed: true,
			attorneyEdit: true,
		});
	});

	it('starts the next version when the claims changed and were approved again, keeping the previous draft and record', async () => {
		const { tools, read, edit } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft());
		await edit('drafting/hinge/claims.md', 'wherein the lever is steel', 'wherein the lever is made of steel');
		const cleared = await tools.start();
		await edit('drafting/hinge/claims.md', 'approved: false', 'approved: true');
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

	it('adds a Note when the approved claims were never searched against prior art', async () => {
		const unsearched = claims().replace('approved: true\n', 'approved: true\nstatus: not searched — scope unvalidated\n');
		const { tools, read } = setup({ ...gatesOpen, 'drafting/hinge/claims.md': unsearched });
		await tools.start();
		await tools.save(draft());
		await tools.validate();
		expect((await read('drafting/hinge/findings.md')).match(/- `claims-unsearched`[^\n]*/)?.[0]).toBe(
			'- `claims-unsearched` (claims.md): The Approved Claims carry status "not searched — scope unvalidated": they were drafted without a prior-art search. Run the prior-art step and re-approve, or record in the review that the claims are deliberately unsearched.');
	});

	it('refuses a matter name that leaves drafting/ and a matter folder that does not exist', async () => {
		const { tools } = setup(gatesOpen);
		expect([await tools.validate(undefined, '../secrets'), await tools.validate(undefined, 'pump')]).toEqual([
			'The draft was not validated. "../secrets" is not a matter name. Give the folder name under drafting/, e.g. "hinge" for drafting/hinge/.',
			'The draft was not validated. drafting/pump/draft-application.md does not exist: save the draft with write_patent_results, template draft-application, first.',
		]);
	});
});

describe('export_draft_docx', () => {
	it('refuses on an open Inventor Question and on claims changed after approval', async () => {
		const { tools, edit } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft(openQuestion));
		const openQuestionRefusal = await tools.exportDocx();
		await edit('drafting/hinge/claims.md', 'wherein the lever is steel', 'wherein the lever is made of steel');
		const claimsChanged = await tools.exportDocx();
		const unapproved = await tools.exportDocx();
		expect({ openQuestionRefusal, claimsChanged, unapproved }).toMatchSnapshot();
	});

	it('refuses on an unwaived Error that is not an Inventor Question', async () => {
		const { tools, fileSystem } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft().replace('<!-- src: disclosure:§1 -->\n', ''));
		expect({
			result: await tools.exportDocx(),
			docxWritten: await fileSystem.stat(URI.file(`${root}/draft-application.description.docx`)).then(() => true, () => false),
		}).toEqual({
			result: 'The draft was not exported. 1 finding(s) in drafting/hinge/findings.md are open. Open in drafting/hinge/checklist.md: step 5 (Fix or waive the Errors).',
			docxWritten: false,
		});
	});

	it('appends the attorney edits to the Working Record and writes the description, claims and abstract .docx files without markers', async () => {
		const { tools, read, fileSystem, write } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft());
		const saved = await read('drafting/hinge/draft-application.md');
		write('drafting/hinge/draft-application.md', saved.replace('A hinge joins a door to a frame.', 'A hinge pivotally joins a door to a frame.'));
		const result = await tools.exportDocx();
		const docxParagraphs: Record<string, string[]> = {};
		for (const type of ['description', 'claims', 'abstract']) {
			const docx = await fileSystem.readFile(URI.file(`${root}/draft-application.${type}.docx`));
			docxParagraphs[type] = (await mammoth.extractRawText({ buffer: Buffer.from(docx) })).value.split('\n').filter(Boolean);
		}
		const record = await read('drafting/hinge/draft-application.working-record.md');
		const fullCopy = (await mammoth.extractRawText({ buffer: Buffer.from(await fileSystem.readFile(URI.file(`${root}/draft-application.full.docx`))) })).value.split('\n').filter(Boolean);
		expect({
			result,
			docxParagraphs,
			fullCopyStart: fullCopy.slice(0, 3),
			filingManifest: await read('drafting/hinge/filing-manifest.md'),
			attorneyEdits: record.slice(record.indexOf('## Attorney edits')).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>'),
		}).toMatchSnapshot();
	});
});

describe('Inventor Question answers', () => {
	it('the save writes inventor-answers.md; an applied answer closes its question, is recorded, and the export blocks only on the rest', async () => {
		const { tools, read, write } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft(twoQuestions));
		const written = await read('drafting/hinge/inventor-answers.md');
		write('drafting/hinge/inventor-answers.md', fillAnswer(written, 'IQ-1', 'Stainless steel.'));
		await tools.validate();
		const answeredNotApplied = {
			findings: (await read('drafting/hinge/findings.md')).match(/- `inventor-question`[^\n]*/g),
			checklistStep4: (await read('drafting/hinge/checklist.md')).match(/- \[ \] 4\.[^\n]*/)?.[0],
		};
		await tools.save(appliedIq1());
		const exportResult = await tools.exportDocx();
		expect({
			written,
			answeredNotApplied,
			exportResult,
			answersKept: (await read('drafting/hinge/inventor-answers.md')).includes('**Answer:**\nStainless steel.\n'),
			recorded: (await read('drafting/hinge/draft-application.working-record.md')).match(/^- \*\*Inventor answer applied:\*\*.*$/gm)?.map(line => line.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/, '<time>')),
		}).toMatchSnapshot();
	});

	it('a partial answer narrows the question: the save adds a new empty slot and the question stays open', async () => {
		const { tools, read, write } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft(twoQuestions));
		write('drafting/hinge/inventor-answers.md', fillAnswer(await read('drafting/hinge/inventor-answers.md'), 'IQ-1', 'Stainless steel; the hardness is not known.'));
		await tools.save(appliedIq1('\n## Inventor Questions\n\n> **Inventor Question IQ-1:** What hardness has the stainless steel lever?\n'));
		await tools.validate();
		expect({
			answers: (await read('drafting/hinge/inventor-answers.md')).slice((await read('drafting/hinge/inventor-answers.md')).indexOf('## IQ-1')),
			findings: (await read('drafting/hinge/findings.md')).match(/- `inventor-question`[^\n]*/g),
		}).toMatchSnapshot();
	});

	it('an inventor:IQ-n marker without a filled answer is an Error', async () => {
		const { tools, read } = setup(gatesOpen);
		await tools.start();
		await tools.save(draft(twoQuestions));
		await tools.save(appliedIq1());
		await tools.validate();
		expect((await read('drafting/hinge/findings.md')).match(/- `source-marker`[^\n]*/g)).toEqual([
			'- `source-marker` (draft-application.md, line 30): The paragraph at line 30 cites inventor:IQ-1, but inventor-answers.md has no answer to IQ-1.',
		]);
	});
});

describe('Drafting Checklist', () => {
	it('every drafting tool rewrites checklist.md, also after a refusal', async () => {
		const { tools, read, edit } = setup({ ...gatesOpen, 'drafting/hinge/claims.md': claims('false') });
		const refused = await tools.start();
		const afterRefusal = await read('drafting/hinge/checklist.md');
		await edit('drafting/hinge/claims.md', 'approved: false', 'approved: true');
		await tools.start();
		await tools.save(draft(openQuestion));
		expect({ refused, afterRefusal, afterSave: await read('drafting/hinge/checklist.md') }).toMatchSnapshot();
	});
});
