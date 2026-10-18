/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mammoth from 'mammoth';
import * as vscode from 'vscode';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { sha256Hex } from '../../../util/node/crypto';
import { dirname } from '../../../util/vs/base/common/resources';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { checklistPointer, DraftingChecklist, DraftingChecklistStep, gateActionText, gateEdit, nextChecklistStep, readDraftingChecklist, renderChecklist, stepActionText } from '../common/drafting/checklist';
import { DraftFinding, findingLine, isInventorQuestion } from '../common/drafting/finding';
import { blockingFindings, mergeFindings, parseFindingsFile, renderFindingsFile } from '../common/drafting/findingsFile';
import { DRAFT_DOCUMENT_TYPES, DRAFT_OUTLINE_SAVE, DRAFTING_FILE_NAMES, DRAFTING_STYLE_FOLDER, DraftingFolder, resolveDraftingFolder } from '../common/drafting/folderContract';
import { DraftingFrontmatterFields, DraftingGateFlag, DraftingGateState, DraftingOffice, parseDraftingFrontmatter, readGateFlag, readOffice, writeDraftingFrontmatter } from '../common/drafting/frontmatter';
import { parseDraftOutline } from '../common/drafting/outline';
import { checkOutlineClaims } from '../common/drafting/outlineValidators';
import { isStyleExemplar, MAX_STYLE_EXEMPLARS, renderStyleReadme, STYLE_README } from '../common/drafting/styleFolder';
import { validateDraft } from '../common/drafting/validateDraft';
import { addRecordLine, APPROVAL_CLEARED, APPROVED_CLAIMS_HASH, emptyWorkingRecord, readRecordField, setRecordField, EXPORTED_DRAFT_HASH, VALIDATED_DRAFT_HASH, VERSION_CLAIMS_HASH } from '../common/drafting/workingRecord';
import { assertFileOkForTool } from '../node/toolUtils';
import { figureOfSvgFile } from '../../drawings/common/drawingFiles';
import type { MatterFiles } from '../../drawings/node/ops/matterFiles';

/** Reads the text of a PDF style exemplar; the default goes through the FlowLeap PDF Preview extension. */
export type PdfTextReader = (uri: URI) => Promise<string>;

/**
 * The editors of the window, as the drafting tools see them: a file is revealed beside the active
 * editor once, when no visible editor shows it (PRD 0025 decision 3). The default is the VS Code
 * window; the tests, which have no window, inject a fake.
 */
export interface DraftingEditors {
	/** True when a visible editor shows the file. */
	isVisible(uri: URI): boolean;
	/** Opens the file beside the active editor, without taking the focus. */
	showBeside(uri: URI): Promise<void>;
}

/** The VS Code window as {@link DraftingEditors}. */
export const vscodeEditors: DraftingEditors = {
	isVisible: uri => vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === uri.toString()),
	showBeside: async uri => {
		await vscode.window.showTextDocument(vscode.Uri.from(uri), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
	},
};

/** Characters of one exemplar returned; the rest is cut and the cut is stated. */
const MAX_EXEMPLAR_CHARS = 20_000;

/** The state of the claims approval of a matter, read from `claims.md` and the Working Record. */
export interface ClaimsApproval {
	/** The `approved` flag of `claims.md`, or `'no-file'` when the file does not exist. */
	readonly gate: DraftingGateState | 'no-file';
	/** SHA-256 of the claims body (the frontmatter is not hashed, so setting the flag does not change it). */
	readonly hash?: string;
	/** Why the approval does not hold for the draft, when the claims changed. */
	readonly changed?: string;
	/** True when this check set `approved: false` in `claims.md`. */
	readonly cleared?: boolean;
}

/** A style exemplar as text. */
export interface StyleExemplar {
	readonly path: string;
	readonly text?: string;
	readonly truncated?: boolean;
	readonly error?: string;
}

/**
 * A Note, never an Error, when the claims file still carries the "not searched" status the
 * claim-drafting skill writes for claims drafted without a prior-art search. The attorney may
 * approve such claims on purpose; the record must show it.
 */
function unsearchedClaimsNote(claims: string): DraftFinding[] {
	const status = parseDraftingFrontmatter(claims).fields.status;
	if (typeof status !== 'string' || !/^not searched/i.test(status.trim())) {
		return [];
	}
	return [{ severity: 'Note', rule: 'claims-unsearched', file: DRAFTING_FILE_NAMES.claims, message: `The Approved Claims carry status "${status.trim()}": they were drafted without a prior-art search. Run the prior-art step and re-approve, or record in the review that the claims are deliberately unsearched.` }];
}

/** The SHA-256 of the claims body of a `claims.md` text: the Approved Claims hash. */
function claimsHash(claims: string): string {
	return sha256Hex(parseDraftingFrontmatter(claims).body.trim());
}

/**
 * Why a Draft Outline was not made for the claims with this hash, or `undefined` when it was:
 * the `outline-claims` rule, whose message names both hashes.
 */
function outlineStaleReason(outline: string, approvedClaimsHash: string): string | undefined {
	return checkOutlineClaims(parseDraftOutline(outline), approvedClaimsHash)[0]?.message;
}

/**
 * The SHA-256 of a draft text together with the claims body it was checked or exported with: a
 * validator run or an export is current while the hash of the current files matches.
 */
function draftHash(draft: string, claims: string): string {
	return sha256Hex(`${draft}\0${claimsHash(claims)}`);
}

/** The frontmatter field of `claims.md` that ties `approved: true` to the claims body it approved. */
const APPROVED_HASH_FIELD = 'approvedHash';

/** The fields with `approvedHash` set right after `approved`. */
function withApprovedHash(fields: DraftingFrontmatterFields, hash: string): DraftingFrontmatterFields {
	const result: DraftingFrontmatterFields = {};
	for (const [key, value] of Object.entries(withoutApprovedHash(fields))) {
		result[key] = value;
		if (key === 'approved') {
			result[APPROVED_HASH_FIELD] = hash;
		}
	}
	return result;
}

function withoutApprovedHash(fields: DraftingFrontmatterFields): DraftingFrontmatterFields {
	return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== APPROVED_HASH_FIELD));
}

/** The outcome of a save of a drafting file through `write_patent_results`: the refusal, or what was written. */
export type DraftingSaveResult =
	| { readonly saved: false; readonly reason: string }
	| { readonly saved: true; readonly message: string };

/** The Draft Outline of a matter and, when it was made for other claims, why it does not hold. */
export interface DraftOutlineState {
	/** `draft-outline.md`. */
	readonly text: string;
	/** Why the outline does not hold for the Approved Claims; absent when it was made for them. */
	readonly stale?: string;
}

/** A tool result of one text part. */
export function textResult(text: string): LanguageModelToolResult {
	return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
}

/**
 * The refusal sentence for a gate that is not open: the one edit that opens it, with the file and
 * the line, e.g. "Review `drafting/x/claims.md:3`, then change `false` to `true` on line 3."
 * `text` is the file, absent when the file does not exist.
 */
function gateRefusal(path: string, flag: DraftingGateFlag, text: string | undefined): string {
	if (text === undefined) {
		return `${path} does not exist. The attorney opens this gate in that file after review.`;
	}
	return `${gateActionText(path, gateEdit(text, flag))} Only the attorney opens this gate; a statement in chat does not open it.`;
}

/**
 * The files of one drafting matter (`drafting/<matter>/` in a workspace folder) and the gate
 * checks the drafting tools share. Every read and write goes through `assertFileOkForTool`.
 */
export class DraftingWorkspace {

	/**
	 * Finds the workspace folder of a matter: the only folder, or in a multi-root workspace the
	 * folder that has `drafting/<matter>/`. Returns the refusal text when there is none.
	 */
	static async locate(matter: string | undefined, workspaceService: IWorkspaceService, fileSystemService: IFileSystemService, instantiationService: IInstantiationService, editors: DraftingEditors = vscodeEditors): Promise<DraftingWorkspace | string> {
		matter ??= '';
		const folders = workspaceService.getWorkspaceFolders();
		const folder = resolveDraftingFolder(matter);
		if (!folder) {
			return `"${matter}" is not a matter name. Give the folder name under drafting/, e.g. "hinge" for drafting/hinge/.`;
		}
		if (!folders.length) {
			return 'No workspace folder is open.';
		}
		if (folders.length > 1) {
			for (const root of folders) {
				try {
					await fileSystemService.stat(URI.joinPath(root, folder.folder));
					return new DraftingWorkspace(root, folder, fileSystemService, instantiationService, editors);
				} catch {
					// Not in this folder.
				}
			}
			return `No workspace folder has ${folder.folder}/.`;
		}
		return new DraftingWorkspace(folders[0], folder, fileSystemService, instantiationService, editors);
	}

	constructor(
		readonly root: URI,
		readonly folder: DraftingFolder,
		private readonly fileSystemService: IFileSystemService,
		private readonly instantiationService: IInstantiationService,
		private readonly editors: DraftingEditors = vscodeEditors,
	) { }

	uri(path: string): URI {
		return URI.joinPath(this.root, path);
	}

	/** Reads a workspace-relative file; `undefined` when it does not exist. */
	async readBytes(path: string): Promise<Uint8Array | undefined> {
		const uri = this.uri(path);
		await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, uri));
		try {
			return await this.fileSystemService.readFile(uri, true);
		} catch {
			return undefined;
		}
	}

	async read(path: string): Promise<string | undefined> {
		const bytes = await this.readBytes(path);
		return bytes ? new TextDecoder().decode(bytes) : undefined;
	}

	async write(path: string, content: string | Uint8Array): Promise<void> {
		const uri = this.uri(path);
		await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, uri));
		await createDirectoryIfNotExists(this.fileSystemService, dirname(uri));
		await this.fileSystemService.writeFile(uri, typeof content === 'string' ? new TextEncoder().encode(content) : content);
	}

	/**
	 * Reads the claims approval. The approval is tied to the claims body by `approvedHash` in the
	 * frontmatter of `claims.md`, beside `approved`:
	 *
	 * - `approved: true` without `approvedHash` is a new approval: the hash of the body is written.
	 * - `approved: true` with an `approvedHash` the body no longer has: the claims changed after
	 *   approval, so `approved` is set to `false`, `approvedHash` is removed and the clearing is
	 *   recorded in the Working Record. The attorney's next `approved: true` is a new approval.
	 * - `approved` not `true`: a left-over `approvedHash` is removed, so a later approval is new.
	 *
	 * When the approval holds but the saved draft version was generated against other claims, the
	 * draft is stale (`changed`, not `cleared`).
	 */
	async checkClaimsApproval(): Promise<ClaimsApproval> {
		const text = await this.read(this.folder.claims);
		if (text === undefined) {
			return { gate: 'no-file' };
		}
		const { fields } = parseDraftingFrontmatter(text);
		const hash = claimsHash(text);
		const gate = readGateFlag(fields, 'approved');
		const approvedHash = fields[APPROVED_HASH_FIELD];
		if (gate === 'set' && approvedHash !== undefined && approvedHash !== hash) {
			await this.write(this.folder.claims, writeDraftingFrontmatter({ ...withoutApprovedHash(fields), approved: false }, text));
			const record = await this.read(this.folder.workingRecord) ?? emptyWorkingRecord(this.folder.matter);
			await this.write(this.folder.workingRecord, addRecordLine(record, APPROVAL_CLEARED, `${new Date().toISOString()} (${DRAFTING_FILE_NAMES.claims} changed after approval)`));
			return {
				gate: 'not-true',
				hash,
				cleared: true,
				changed: `${this.folder.claims} changed after it was approved, so the approval was withdrawn. ${gateActionText(this.folder.claims, gateEdit(await this.read(this.folder.claims) ?? '', 'approved'))} Then start_application_draft and a new save start the next draft version.`,
			};
		}
		if (gate === 'set' && approvedHash === undefined) {
			await this.write(this.folder.claims, writeDraftingFrontmatter(withApprovedHash(fields, hash), text));
		} else if (gate !== 'set' && approvedHash !== undefined) {
			await this.write(this.folder.claims, writeDraftingFrontmatter(withoutApprovedHash(fields), text));
		}
		const versionHash = readRecordField(await this.read(this.folder.workingRecord) ?? '', VERSION_CLAIMS_HASH);
		if (versionHash && versionHash !== hash) {
			return { gate, hash, changed: `The saved draft was generated against other claims than the current ${this.folder.claims}. Call start_application_draft, regenerate the specification and save it: the save starts the next draft version.` };
		}
		return { gate, hash };
	}

	/**
	 * The `confirmed` gate of `feature-list.md`: its frontmatter fields when the flag is set, else
	 * the refusal naming the flag and the file.
	 */
	async requireConfirmedFeatureList(): Promise<{ readonly text: string; readonly fields: DraftingFrontmatterFields } | string> {
		const text = await this.read(this.folder.featureList);
		if (text === undefined) {
			return gateRefusal(this.folder.featureList, 'confirmed', undefined);
		}
		const { fields } = parseDraftingFrontmatter(text);
		return readGateFlag(fields, 'confirmed') === 'set' ? { text, fields } : gateRefusal(this.folder.featureList, 'confirmed', text);
	}

	/**
	 * The `approved` gate of `claims.md` (see {@link checkClaimsApproval}): the approval when it
	 * holds, else the refusal naming the flag and the file, or saying that the claims changed.
	 * A stale draft (`changed` without `cleared`) is returned for the caller to judge.
	 */
	async requireApprovedClaims(): Promise<ClaimsApproval & { readonly hash: string } | string> {
		const approval = await this.checkClaimsApproval();
		if (approval.changed && approval.cleared) {
			return approval.changed;
		}
		if (approval.gate !== 'set' || !approval.hash) {
			return gateRefusal(this.folder.claims, 'approved', approval.gate === 'no-file' ? undefined : await this.read(this.folder.claims) ?? '');
		}
		return { ...approval, hash: approval.hash };
	}

	/** Records the approved claims hash in the Working Record: the claims the next draft is generated against. */
	async recordApprovedClaims(hash: string): Promise<void> {
		const record = await this.read(this.folder.workingRecord) ?? emptyWorkingRecord(this.folder.matter);
		await this.write(this.folder.workingRecord, setRecordField(record, APPROVED_CLAIMS_HASH, hash));
	}

	/**
	 * Reads `draft-outline.md` and checks that its `claims` hash is the given Approved Claims hash;
	 * `undefined` when the file does not exist.
	 *
	 * Editing the claims clears the outline binding as it clears `approved`, with no edit of the
	 * outline file: the claims body gets a new hash, so the outline's `claims` hash no longer
	 * matches. The hash mismatch is the signal.
	 */
	async readOutline(approvedClaimsHash: string): Promise<DraftOutlineState | undefined> {
		const text = await this.read(this.folder.draftOutline);
		if (text === undefined) {
			return undefined;
		}
		const stale = outlineStaleReason(text, approvedClaimsHash);
		return stale ? { text, stale } : { text };
	}

	/**
	 * The Draft Outline precondition of the draft save (PRD 0022 decision 1: a code precondition,
	 * not a human gate): the outline text when `draft-outline.md` exists and was made for the given
	 * Approved Claims hash, else the refusal naming the file and the template to save it with.
	 */
	async requireOutline(approvedClaimsHash: string): Promise<string | { readonly text: string }> {
		const outline = await this.readOutline(approvedClaimsHash);
		const path = this.folder.draftOutline;
		if (!outline) {
			return `${path} does not exist. Save the Draft Outline for the Approved Claims ${DRAFT_OUTLINE_SAVE}, to ${path} first; then save the draft.`;
		}
		return outline.stale ? `${outline.stale} Save it ${DRAFT_OUTLINE_SAVE}, to ${path}; then save the draft.` : { text: outline.text };
	}

	/**
	 * The result of a save, ending with the checklist line: after a refusal the open steps, else the
	 * next step. The checklist is written also after a refusal.
	 */
	async withChecklistLine(result: DraftingSaveResult): Promise<DraftingSaveResult> {
		const checklist = await this.checklistLine(!result.saved, result.saved ? undefined : result.reason);
		if (!checklist) {
			return result;
		}
		return result.saved ? { saved: true, message: `${result.message}\n${checklist}` } : { saved: false, reason: `${result.reason} ${checklist}` };
	}

	/** The office of the draft: the draft's frontmatter, else the Feature List's. */
	async office(draft: string | undefined): Promise<DraftingOffice | undefined> {
		const fromDraft = draft ? readOffice(parseDraftingFrontmatter(draft).fields) : undefined;
		if (fromDraft) {
			return fromDraft;
		}
		const featureList = await this.read(this.folder.featureList);
		return featureList ? readOffice(parseDraftingFrontmatter(featureList).fields) : undefined;
	}

	/**
	 * Runs the validators over the draft, with the Draft Outline rules against the current claims
	 * (an `outline-claims` Error when `draft-outline.md` does not exist), adds the claims-change
	 * Error and the advisory items, and writes `findings.md` merged with the previous one (waivers
	 * kept). Records the hash of the validated draft in the Working Record, so the Drafting
	 * Checklist knows when `findings.md` is older than the draft. Returns the merged findings.
	 */
	async validate(office: DraftingOffice, draft: string, claims: string, approval: ClaimsApproval, advisory: readonly DraftFinding[]): Promise<DraftFinding[]> {
		const figures = await this.read(this.folder.figures);
		const inventorAnswers = await this.read(this.folder.inventorAnswers);
		const outline = { text: await this.read(this.folder.draftOutline), approvedClaimsHash: claimsHash(claims), featureList: await this.read(this.folder.featureList) ?? '' };
		const current: DraftFinding[] = [
			...(approval.changed ? [{ severity: 'Error' as const, rule: 'claims-changed', file: DRAFTING_FILE_NAMES.claims, message: approval.changed }] : []),
			...unsearchedClaimsNote(claims),
			...validateDraft({ office, draft, claims, figures, inventorAnswers, outline }),
			...advisory,
		];
		const previous = parseFindingsFile(await this.read(this.folder.findings) ?? '');
		const merged = mergeFindings(current, previous);
		await this.write(this.folder.findings, renderFindingsFile(merged));
		const record = await this.read(this.folder.workingRecord) ?? emptyWorkingRecord(this.folder.matter);
		await this.write(this.folder.workingRecord, setRecordField(record, VALIDATED_DRAFT_HASH, draftHash(draft, claims)));
		return merged;
	}

	/** Records in the Working Record the hash of the draft and claims an export was written from. */
	async recordExport(draft: string, claims: string): Promise<void> {
		const record = await this.read(this.folder.workingRecord) ?? emptyWorkingRecord(this.folder.matter);
		await this.write(this.folder.workingRecord, setRecordField(record, EXPORTED_DRAFT_HASH, draftHash(draft, claims)));
	}

	/** The files of this matter for the drawing operations: paths relative to `drafting/<matter>/`. */
	matterFiles(): MatterFiles {
		const at = (path: string) => `${this.folder.folder}/${path}`;
		return {
			folder: this.folder.folder,
			read: path => this.read(at(path)),
			readBytes: path => this.readBytes(at(path)),
			write: (path, content) => this.write(at(path), content),
			listFiles: folder => this.listFiles(at(folder)),
			delete: path => this.delete(at(path)),
			exists: path => this.exists(at(path)),
		};
	}

	/** The names of the files in a workspace-relative folder, sorted; empty when the folder does not exist. */
	async listFiles(path: string): Promise<string[]> {
		const uri = this.uri(path);
		await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, uri));
		try {
			return (await this.fileSystemService.readDirectory(uri)).filter(([, type]) => type === FileType.File).map(([name]) => name).sort();
		} catch {
			return [];
		}
	}

	/** Deletes a workspace-relative file; nothing happens when it does not exist. */
	async delete(path: string): Promise<void> {
		const uri = this.uri(path);
		await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, uri));
		if (await this.exists(path)) {
			await this.fileSystemService.delete(uri);
		}
	}

	async exists(path: string): Promise<boolean> {
		try {
			await this.fileSystemService.stat(this.uri(path));
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Writes the Drafting Checklist (`checklist.md`) from the files of the matter and returns it.
	 * Every drafting tool and every drawing tool calls it after it runs, also after a refusal.
	 * Nothing is written while the matter has no folder and no drafting input.
	 */
	private async writeChecklist(): Promise<DraftingChecklist | undefined> {
		const { folder } = this;
		const [featureList, claims, draftOutline, draft] = [await this.read(folder.featureList), await this.read(folder.claims), await this.read(folder.draftOutline), await this.read(folder.draft)];
		if (featureList === undefined && claims === undefined && draftOutline === undefined && draft === undefined && !await this.exists(folder.folder)) {
			return undefined;
		}
		const findings = await this.read(folder.findings);
		const record = await this.read(folder.workingRecord) ?? '';
		const currentHash = draft !== undefined && claims !== undefined ? draftHash(draft, claims) : undefined;
		let exported = !!currentHash && readRecordField(record, EXPORTED_DRAFT_HASH) === currentHash;
		for (const type of DRAFT_DOCUMENT_TYPES) {
			exported &&= await this.exists(folder.docx[type]);
		}
		const claimsFields = claims !== undefined ? parseDraftingFrontmatter(claims).fields : {};
		const approvedHash = claimsFields[APPROVED_HASH_FIELD];
		const versionHash = readRecordField(record, VERSION_CLAIMS_HASH);
		const checklist = readDraftingChecklist({
			matter: folder.matter,
			featureList,
			claims,
			claimsChangedSinceApproval: claims !== undefined && readGateFlag(claimsFields, 'approved') === 'set' && approvedHash !== undefined && approvedHash !== claimsHash(claims),
			draftOutline,
			outlineStale: draftOutline !== undefined && (claims === undefined || !!outlineStaleReason(draftOutline, claimsHash(claims))),
			draft,
			draftStale: draft !== undefined && claims !== undefined && !!versionHash && versionHash !== claimsHash(claims),
			figures: await this.read(folder.figures),
			drawnFigures: (await this.listFiles(folder.drawings)).filter(name => figureOfSvgFile(name) !== undefined).length,
			inventorAnswers: await this.read(folder.inventorAnswers),
			findings,
			findingsCurrent: findings !== undefined && !!currentHash && readRecordField(record, VALIDATED_DRAFT_HASH) === currentHash,
			exported,
			styleExemplars: await this.countStyleExemplars(),
		});
		await this.write(folder.checklist, renderChecklist(checklist));
		await this.revealChecklist();
		return checklist;
	}

	/**
	 * Shows `checklist.md` beside the active editor, without the focus, when no visible editor
	 * shows it: the checklist is revealed, not pushed (PRD 0025 decision 3). A reveal that fails
	 * must not fail the tool call, so the error is swallowed; the result text names the file.
	 */
	private async revealChecklist(): Promise<void> {
		const uri = this.uri(this.folder.checklist);
		try {
			if (!this.editors.isVisible(uri)) {
				await this.editors.showBeside(uri);
			}
		} catch {
			// The result text still names the checklist.
		}
	}

	/**
	 * The result of a refused tool call: the reason, then the open steps of the Drafting Checklist,
	 * which is written first. `prefix` says what did not happen, e.g. "The draft was not exported.".
	 */
	async refusal(prefix: string, reason: string): Promise<LanguageModelToolResult> {
		const pointer = await this.checklistLine(true, reason);
		return textResult(`${prefix} ${reason}${pointer ? `${reason.includes('\n') ? '\n' : ' '}${pointer}` : ''}`);
	}

	/** The text of a tool result that ran, then on a new line the next step of the Drafting Checklist, which is written first. */
	async textWithChecklistLine(text: string): Promise<string> {
		const line = await this.checklistLine(false);
		return line ? `${text}\n${line}` : text;
	}

	/**
	 * Creates the style folder when it has no README, writes the Drafting Checklist and returns the
	 * sentence a tool result ends with: after a refusal the open steps, else the next step; then
	 * what the attorney does for the next step, with the file and the line, unless `said` (the
	 * refusal reason) already says it. Empty when no checklist was written.
	 */
	async checklistLine(refused: boolean, said?: string): Promise<string> {
		await this.ensureStyleFolder();
		const checklist = await this.writeChecklist();
		if (!checklist) {
			return '';
		}
		const next = nextChecklistStep(checklist);
		const action = next ? this.stepAction(next) : '';
		const nextAction = action && !said?.includes(action) ? ` Next: ${action}` : '';
		if (refused) {
			return `${checklistPointer(checklist, this.folder.checklist)}${nextAction}`;
		}
		return `Wrote ${this.folder.checklist}: ${next ? `the next step for the attorney is step ${next.step} (${next.title}).${nextAction}` : 'every step is done.'}`;
	}

	/** What the attorney does for a checklist step, with every `` `file:line` `` as a workspace path. */
	private stepAction(entry: DraftingChecklistStep): string {
		return stepActionText(entry, file => `${this.folder.folder}/${file}`);
	}

	/**
	 * Creates the workspace `style/` folder with its `README.md` when the README is missing. Never
	 * overwrites the README or any other file.
	 */
	private async ensureStyleFolder(): Promise<void> {
		const readme = `${DRAFTING_STYLE_FOLDER}/${STYLE_README}`;
		if (!await this.exists(readme)) {
			await this.write(readme, renderStyleReadme());
		}
	}

	/** The number of style exemplars in the workspace `style/` folder (the README is none). */
	private async countStyleExemplars(): Promise<number> {
		try {
			return (await this.fileSystemService.readDirectory(this.uri(DRAFTING_STYLE_FOLDER))).filter(([name, type]) => type === FileType.File && isStyleExemplar(name)).length;
		} catch {
			return 0;
		}
	}

	/** Reads up to five style exemplars from the workspace `style/` folder, in name order; never the README. */
	async styleExemplars(readPdf: PdfTextReader): Promise<StyleExemplar[]> {
		let entries: [string, FileType][];
		try {
			entries = await this.fileSystemService.readDirectory(this.uri(DRAFTING_STYLE_FOLDER));
		} catch {
			return [];
		}
		const names = entries.filter(([name, type]) => type === FileType.File && isStyleExemplar(name)).map(([name]) => name).sort().slice(0, MAX_STYLE_EXEMPLARS);
		const exemplars: StyleExemplar[] = [];
		for (const name of names) {
			const path = `${DRAFTING_STYLE_FOLDER}/${name}`;
			try {
				const text = await this.exemplarText(path, readPdf);
				exemplars.push(text.length > MAX_EXEMPLAR_CHARS ? { path, text: text.slice(0, MAX_EXEMPLAR_CHARS), truncated: true } : { path, text });
			} catch (error) {
				exemplars.push({ path, error: error instanceof Error ? error.message : String(error) });
			}
		}
		return exemplars;
	}

	private async exemplarText(path: string, readPdf: PdfTextReader): Promise<string> {
		if (/\.pdf$/i.test(path)) {
			await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, this.uri(path)));
			return readPdf(this.uri(path));
		}
		const bytes = await this.readBytes(path);
		if (!bytes) {
			throw new Error('the file could not be read');
		}
		if (/\.docx$/i.test(path)) {
			return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
		}
		return new TextDecoder().decode(bytes);
	}
}

/** Counts by severity and the blocking list, for a tool result. */
export function findingsSummary(findings: readonly DraftFinding[]): string {
	const errors = findings.filter(finding => finding.severity === 'Error' && !isInventorQuestion(finding));
	const questions = findings.filter(isInventorQuestion);
	const count = (severity: DraftFinding['severity']) => findings.filter(finding => finding.severity === severity).length;
	const blocking = blockingFindings(findings);
	return [
		`Errors: ${errors.length} (${errors.filter(finding => finding.waived).length} waived). Inventor Questions: ${questions.length} (${questions.filter(finding => finding.waived).length} waived). Notes: ${count('Note')}. Advisory: ${count('Advisory')}.`,
		blocking.length ? `Blocking export (${blocking.length}):\n${blocking.map(findingLine).join('\n')}` : 'No unwaived Error and no open Inventor Question.',
	].join('\n');
}
