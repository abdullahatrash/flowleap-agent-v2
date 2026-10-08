/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as mammoth from 'mammoth';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { dirname } from '../../../util/vs/base/common/resources';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { DraftFinding, isInventorQuestion } from '../common/drafting/finding';
import { blockingFindings, mergeFindings, parseFindingsFile, renderFindingsFile } from '../common/drafting/findingsFile';
import { DRAFTING_FILE_NAMES, DRAFTING_STYLE_FOLDER, DraftingFolder, resolveDraftingFolder } from '../common/drafting/folderContract';
import { DraftingFrontmatterFields, DraftingGateFlag, DraftingGateState, DraftingOffice, parseDraftingFrontmatter, readGateFlag, readOffice, writeDraftingFrontmatter } from '../common/drafting/frontmatter';
import { validateDraft } from '../common/drafting/validateDraft';
import { addRecordLine, APPROVAL_CLEARED, APPROVED_CLAIMS_HASH, emptyWorkingRecord, readRecordField, setRecordField, VERSION_CLAIMS_HASH } from '../common/drafting/workingRecord';
import { assertFileOkForTool } from '../node/toolUtils';

/** Reads the text of a PDF style exemplar; the default goes through the FlowLeap PDF Preview extension. */
export type PdfTextReader = (uri: URI) => Promise<string>;

/** At most this many style exemplars are returned. */
const MAX_EXEMPLARS = 5;

/** Characters of one exemplar returned; the rest is cut and the cut is stated. */
const MAX_EXEMPLAR_CHARS = 20_000;

const exemplarExtensions = /\.(?:md|docx|pdf)$/i;

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

/** The SHA-256 of the claims body of a `claims.md` text. */
function claimsHash(claims: string): string {
	return createHash('sha256').update(parseDraftingFrontmatter(claims).body.trim()).digest('hex');
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

/** A tool result of one text part. */
export function textResult(text: string): LanguageModelToolResult {
	return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
}

/** The refusal sentence for a gate flag that is not set. */
function gateRefusal(path: string, flag: DraftingGateFlag, state: DraftingGateState | 'no-file'): string {
	if (state === 'no-file') {
		return `${path} does not exist. The attorney sets \`${flag}: true\` in its frontmatter after review.`;
	}
	return state === 'missing'
		? `${path} has no \`${flag}\` flag in its frontmatter. The attorney sets \`${flag}: true\` after review; a statement in chat does not open this gate.`
		: `\`${flag}\` in ${path} is not \`true\`. The attorney sets \`${flag}: true\` after review; a statement in chat does not open this gate.`;
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
	static async locate(matter: string | undefined, workspaceService: IWorkspaceService, fileSystemService: IFileSystemService, instantiationService: IInstantiationService): Promise<DraftingWorkspace | string> {
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
					return new DraftingWorkspace(root, folder, fileSystemService, instantiationService);
				} catch {
					// Not in this folder.
				}
			}
			return `No workspace folder has ${folder.folder}/.`;
		}
		return new DraftingWorkspace(folders[0], folder, fileSystemService, instantiationService);
	}

	constructor(
		readonly root: URI,
		readonly folder: DraftingFolder,
		private readonly fileSystemService: IFileSystemService,
		private readonly instantiationService: IInstantiationService,
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
				changed: `${this.folder.claims} changed after it was approved, so \`approved\` was set to \`false\`. The attorney reviews the claims and sets \`approved: true\` again; then start_application_draft and a new save start the next draft version.`,
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
			return gateRefusal(this.folder.featureList, 'confirmed', 'no-file');
		}
		const { fields } = parseDraftingFrontmatter(text);
		const confirmed = readGateFlag(fields, 'confirmed');
		return confirmed === 'set' ? { text, fields } : gateRefusal(this.folder.featureList, 'confirmed', confirmed);
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
			return gateRefusal(this.folder.claims, 'approved', approval.gate);
		}
		return { ...approval, hash: approval.hash };
	}

	/** Records the approved claims hash in the Working Record: the claims the next draft is generated against. */
	async recordApprovedClaims(hash: string): Promise<void> {
		const record = await this.read(this.folder.workingRecord) ?? emptyWorkingRecord(this.folder.matter);
		await this.write(this.folder.workingRecord, setRecordField(record, APPROVED_CLAIMS_HASH, hash));
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
	 * Runs the validators over the draft, adds the claims-change Error and the advisory items, and
	 * writes `findings.md` merged with the previous one (waivers kept). Returns the merged findings.
	 */
	async validate(office: DraftingOffice, draft: string, claims: string, approval: ClaimsApproval, advisory: readonly DraftFinding[]): Promise<DraftFinding[]> {
		const figures = await this.read(this.folder.figures);
		const inventorAnswers = await this.read(this.folder.inventorAnswers);
		const current: DraftFinding[] = [
			...(approval.changed ? [{ severity: 'Error' as const, rule: 'claims-changed', file: DRAFTING_FILE_NAMES.claims, message: approval.changed }] : []),
			...unsearchedClaimsNote(claims),
			...validateDraft({ office, draft, claims, figures, inventorAnswers }),
			...advisory,
		];
		const previous = parseFindingsFile(await this.read(this.folder.findings) ?? '');
		const merged = mergeFindings(current, previous);
		await this.write(this.folder.findings, renderFindingsFile(merged));
		return merged;
	}

	/** Reads up to five style exemplars from the workspace `style/` folder, in name order. */
	async styleExemplars(readPdf: PdfTextReader): Promise<StyleExemplar[]> {
		let entries: [string, FileType][];
		try {
			entries = await this.fileSystemService.readDirectory(this.uri(DRAFTING_STYLE_FOLDER));
		} catch {
			return [];
		}
		const names = entries.filter(([name, type]) => type === FileType.File && exemplarExtensions.test(name)).map(([name]) => name).sort().slice(0, MAX_EXEMPLARS);
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

/** One line per finding, for a tool result. */
export function findingLine(finding: DraftFinding): string {
	const location = [finding.file, finding.line !== undefined ? `line ${finding.line}` : undefined, finding.claim !== undefined ? `claim ${finding.claim}` : undefined].filter(Boolean).join(', ');
	return `- \`${finding.rule}\`${location ? ` (${location})` : ''}: ${finding.message.replace(/\s*\n\s*/g, ' ')}`;
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
