/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { IIgnoreService, NullIgnoreService } from '../../../../platform/ignore/common/ignoreService';
import { IPromptPathRepresentationService, PromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { sha256Hex } from '../../../../util/node/crypto';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService, ServiceIdentifier, ServicesAccessor } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { WorkspaceEdit } from '../../../../vscodeTypes';
import { DraftFinding } from '../../common/drafting/finding';
import { renderFindingsFile } from '../../common/drafting/findingsFile';
import { parseDraftingFrontmatter } from '../../common/drafting/frontmatter';
import { emptyWorkingRecord, setRecordField, VALIDATED_DRAFT_HASH, VERSION_CLAIMS_HASH } from '../../common/drafting/workingRecord';
import { DraftingGateActions, DraftingGateTextDocument, DraftingGateWindow } from '../draftingGateContribution';
import { DraftingEditors } from '../draftingWorkspace';
import { applied } from './draftingGateTestUtils';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));

const claims = (approved: string) => `---\napproved: ${approved}\n---\n1. A hinge comprising a housing and a lever.\n2. The hinge of claim 1, wherein the lever is steel.\n`;
const claimsHash = (text: string) => sha256Hex(parseDraftingFrontmatter(text).body.trim());
const draft = '---\noffice: US\nmodel: claude-sonnet-5\nprovider: anthropic\n---\n# Hinge\n\n## DETAILED DESCRIPTION\n\n<!-- src: feature:F1 -->\nThe housing 12 holds the lever 14.\n';
const errors: DraftFinding[] = [
	{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 4, claim: 2, message: 'Claim 2: "the clamp body" has no antecedent basis.' },
	{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 5, claim: 3, message: 'Claim 3: "the pin" has no antecedent basis.' },
	{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 12, message: 'Line 12 writes "clamp-body"; the defined term is "clamp body".' },
];

/** A matter with both gates closed, a draft validated against the current claims, and three open Errors. */
function matterFiles(): Record<string, string> {
	const claimsText = claims('false');
	const record = setRecordField(setRecordField(emptyWorkingRecord('hinge'), VERSION_CLAIMS_HASH, claimsHash(claimsText)), VALIDATED_DRAFT_HASH, sha256Hex(`${draft}\0${claimsHash(claimsText)}`));
	return {
		'drafting/hinge/feature-list.md': '---\noffice: US\nconfirmed: false\n---\n| F1 | lever |\n',
		'drafting/hinge/claims.md': claimsText,
		'drafting/hinge/draft-outline.md': `---\noffice: US\nclaims: ${claimsHash(claimsText)}\n---\n# Draft Outline\n`,
		'drafting/hinge/draft-application.md': draft,
		'drafting/hinge/draft-application.working-record.md': record,
		'drafting/hinge/findings.md': renderFindingsFile(errors),
	};
}

/** The window as a fake over the file system: edits land in the files, the input box and the quick pick answer from the test. */
class FakeWindow implements DraftingGateWindow {
	reason: string | undefined;
	/** The index of the quick pick item the test picks; `undefined` cancels. */
	pickIndex: number | undefined;
	readonly picks: string[][] = [];
	readonly informed: string[] = [];
	readonly saved: string[] = [];
	constructor(private readonly fileSystem: MockFileSystemService, private readonly files: string[]) { }
	async openDocument(uri: vscode.Uri): Promise<DraftingGateTextDocument> {
		const text = await this.text(uri);
		return { uri, getText: () => text, save: async () => { this.saved.push(uri.path); return true; } };
	}
	async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
		for (const [uri] of edit.entries()) {
			this.fileSystem.mockFile(uri, applied(await this.text(uri), edit)!);
		}
		return true;
	}
	askReason = async () => this.reason;
	async pick<T extends vscode.QuickPickItem>(items: readonly T[]): Promise<T | undefined> {
		this.picks.push(items.map(item => item.label));
		return this.pickIndex === undefined ? undefined : items[this.pickIndex];
	}
	async findFiles(pattern: string): Promise<vscode.Uri[]> {
		const name = pattern.split('/').at(-1);
		return this.files.filter(file => /^drafting\/[^/]+\/[^/]+$/.test(file) && file.endsWith(`/${name}`)).map(file => URI.file(`/workspace/${file}`));
	}
	inform(message: string): void {
		this.informed.push(message);
	}
	private async text(uri: vscode.Uri): Promise<string> {
		return new TextDecoder().decode(await this.fileSystem.readFile(URI.from(uri)));
	}
}

function setup(files = matterFiles()) {
	const fileSystem = new MockFileSystemService();
	for (const [path, contents] of Object.entries(files)) {
		fileSystem.mockFile(URI.file(`/workspace/${path}`), contents);
	}
	const workspace = new class extends TestWorkspaceService { override getWorkspaceFolders() { return [URI.file('/workspace')]; } }();
	const services = new Map<unknown, unknown>([[IIgnoreService, new NullIgnoreService()], [IWorkspaceService, workspace], [IPromptPathRepresentationService, new PromptPathRepresentationService(workspace)]]);
	const accessor: ServicesAccessor = { get: <T>(id: ServiceIdentifier<T>) => (services.get(id) ?? {}) as T };
	const instantiation = new class extends mock<IInstantiationService>() {
		override invokeFunction<R, TS extends unknown[] = []>(fn: (accessor: ServicesAccessor, ...args: TS) => R, ...args: TS): R { return fn(accessor, ...args); }
	}();
	const editors = new class implements DraftingEditors {
		readonly shown: string[] = [];
		isVisible(): boolean { return false; }
		async showBeside(uri: URI): Promise<void> { this.shown.push(uri.path); }
	}();
	const window = new FakeWindow(fileSystem, Object.keys(files));
	const actions = new DraftingGateActions(workspace, fileSystem, instantiation, window, editors);
	const read = async (path: string) => new TextDecoder().decode(await fileSystem.readFile(URI.file(`/workspace/${path}`)));
	const exists = async (path: string) => { try { await fileSystem.stat(URI.file(`/workspace/${path}`)); return true; } catch { return false; } };
	/** The checklist lines of the steps and the next-step line. */
	const checklist = async () => (await read('drafting/hinge/checklist.md')).split('\n').filter(line => /^- \[|^Next step/.test(line));
	const uri = (path: string) => URI.file(`/workspace/${path}`);
	return { actions, window, editors, read, exists, checklist, uri };
}

describe('Drafting gate actions', () => {
	it('a gate click writes the flag and rewrites checklist.md at once; from the preview, the file is found in the workspace', async () => {
		const { actions, window, editors, read, checklist, uri } = setup();
		await actions.setGateFlag('confirmed', uri('drafting/hinge/feature-list.md'));
		const afterConfirm = await checklist();
		await actions.setGateFlag('approved', undefined);
		const afterApprove = await checklist();
		await actions.setGateFlag('approved', undefined);
		expect({
			featureList: await read('drafting/hinge/feature-list.md'),
			claims: (await read('drafting/hinge/claims.md')).split('\n').slice(0, 3),
			afterConfirm,
			afterApprove,
			saved: window.saved,
			informed: window.informed,
			picks: window.picks,
			revealed: editors.shown,
		}).toMatchSnapshot();
	});

	it('"Waive Errors…" offers all open Errors or one rule, writes one reason under each item, and the checklist moves on; a cancel writes nothing', async () => {
		const { actions, window, read, exists, checklist, uri } = setup();
		await actions.setGateFlag('confirmed', uri('drafting/hinge/feature-list.md'));
		await actions.setGateFlag('approved', uri('drafting/hinge/claims.md'));
		const before = await checklist();
		await actions.waiveOpenErrors(undefined);
		const findingsAfterCancel = await read('drafting/hinge/findings.md');
		window.pickIndex = 1;
		window.reason = 'False positive: "a clamp body" is in claim 1.';
		await actions.waiveOpenErrors(undefined);
		const afterRule = await checklist();
		window.pickIndex = 0;
		window.reason = 'Client spelling.';
		await actions.waiveOpenErrors(uri('drafting/hinge/findings.md'));
		const afterAll = await checklist();
		await actions.waiveOpenErrors(uri('drafting/hinge/findings.md'));
		expect({
			before,
			cancelled: findingsAfterCancel === renderFindingsFile(errors),
			picks: window.picks,
			afterRule,
			findings: await read('drafting/hinge/findings.md'),
			afterAll,
			informed: window.informed,
		}).toMatchSnapshot();
		expect(await exists('drafting/hinge/checklist.md')).toBe(true);
	});

	it('the CodeLens path waives the clicked lines and rewrites the checklist too', async () => {
		const { actions, window, read, checklist, uri } = setup();
		window.reason = 'Boilerplate.';
		const line = renderFindingsFile(errors).split('\n').findIndex(text => text.includes('`defined-term`')) + 1;
		await actions.waive(uri('drafting/hinge/findings.md'), [line]);
		expect({ waived: (await read('drafting/hinge/findings.md')).match(/- `defined-term`[^\n]*\n[^\n]*/)?.[0], step4: (await checklist()).find(text => text.includes('4.')) }).toMatchSnapshot();
	});

	it('without a drafting file in the workspace the click says so and writes nothing', async () => {
		const { actions, window, exists } = setup({ 'notes/findings.md': renderFindingsFile(errors) });
		await actions.waiveOpenErrors(undefined);
		await actions.setGateFlag('confirmed', undefined);
		expect({ informed: window.informed, checklist: await exists('drafting/hinge/checklist.md') }).toEqual({
			informed: ['No workspace folder has drafting/<matter>/findings.md.', 'No workspace folder has drafting/<matter>/feature-list.md.'],
			checklist: false,
		});
	});
});
