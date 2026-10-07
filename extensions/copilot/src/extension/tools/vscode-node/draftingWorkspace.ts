/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as mammoth from 'mammoth';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { dirname } from '../../../util/vs/base/common/resources';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { DraftFinding } from '../common/drafting/finding';
import { blockingFindings, mergeFindings, parseFindingsFile, renderFindingsFile } from '../common/drafting/findingsFile';
import { DRAFTING_STYLE_FOLDER, DraftingFolder, resolveDraftingFolder } from '../common/drafting/folderContract';
import { DraftingGateFlag, DraftingGateState, DraftingOffice, parseDraftingFrontmatter, readGateFlag, readOffice, writeDraftingFrontmatter } from '../common/drafting/frontmatter';
import { validateDraft } from '../common/drafting/validateDraft';
import { APPROVAL_CLEARED, APPROVED_CLAIMS_HASH, emptyWorkingRecord, readRecordField, setRecordField, VERSION_CLAIMS_HASH } from '../common/drafting/workingRecord';
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

/** The SHA-256 of the claims body of a `claims.md` text. */
export function claimsHash(claims: string): string {
	return createHash('sha256').update(parseDraftingFrontmatter(claims).body.trim()).digest('hex');
}

/** The refusal sentence for a gate flag that is not set. */
export function gateRefusal(path: string, flag: DraftingGateFlag, state: DraftingGateState | 'no-file'): string {
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
	static async locate(matter: string, folders: readonly URI[], fileSystemService: IFileSystemService, instantiationService: IInstantiationService): Promise<DraftingWorkspace | string> {
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
	 * Reads the claims approval. When the claims body changed after `start_application_draft`
	 * recorded it, the approval no longer holds: a set `approved` flag is cleared in `claims.md`
	 * (set to `false`) and the new hash is recorded, so the attorney's next `approved: true` is a
	 * new approval. When the approval is current but the saved draft version was generated
	 * against other claims, the draft is stale.
	 */
	async checkClaimsApproval(): Promise<ClaimsApproval> {
		const text = await this.read(this.folder.claims);
		if (text === undefined) {
			return { gate: 'no-file' };
		}
		const { fields } = parseDraftingFrontmatter(text);
		const hash = claimsHash(text);
		const record = await this.read(this.folder.workingRecord) ?? '';
		const approvedHash = readRecordField(record, APPROVED_CLAIMS_HASH);
		if (approvedHash && approvedHash !== hash) {
			const gate = readGateFlag(fields, 'approved');
			const cleared = gate === 'set';
			if (cleared) {
				await this.write(this.folder.claims, writeDraftingFrontmatter({ ...fields, approved: false }, text));
			}
			let updated = setRecordField(record || emptyWorkingRecord(this.folder.matter), APPROVED_CLAIMS_HASH, hash);
			updated = setRecordField(updated, APPROVAL_CLEARED, `${new Date().toISOString()} (claims.md changed after approval)`);
			await this.write(this.folder.workingRecord, updated);
			return {
				gate: cleared ? 'not-true' : gate,
				hash,
				cleared,
				changed: `${this.folder.claims} changed after it was approved for this draft${cleared ? ', so `approved` was set to `false`' : ''}. The attorney reviews the claims and sets \`approved: true\` again; then start_application_draft and a new save start the next draft version.`,
			};
		}
		const versionHash = readRecordField(record, VERSION_CLAIMS_HASH);
		const gate = readGateFlag(fields, 'approved');
		if (versionHash && versionHash !== hash) {
			return { gate, hash, changed: `The saved draft was generated against other claims than the current ${this.folder.claims}. Call start_application_draft, regenerate the specification and save it: the save starts the next draft version.` };
		}
		return { gate, hash };
	}

	/** Records the approved claims hash in the Working Record (the start of a draft). */
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
		const current: DraftFinding[] = [
			...(approval.changed ? [{ severity: 'Error' as const, rule: 'claims-changed', file: 'claims.md', message: approval.changed }] : []),
			...validateDraft({ office, draft, claims, figures }),
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
	const errors = findings.filter(finding => finding.severity === 'Error' && finding.rule !== 'inventor-question');
	const questions = findings.filter(finding => finding.rule === 'inventor-question');
	const count = (severity: DraftFinding['severity']) => findings.filter(finding => finding.severity === severity).length;
	const blocking = blockingFindings(findings);
	return [
		`Errors: ${errors.length} (${errors.filter(finding => finding.waived).length} waived). Inventor Questions: ${questions.length} (${questions.filter(finding => finding.waived).length} waived). Notes: ${count('Note')}. Advisory: ${count('Advisory')}.`,
		blocking.length ? `Blocking export (${blocking.length}):\n${blocking.map(findingLine).join('\n')}` : 'No unwaived Error and no open Inventor Question.',
	].join('\n');
}
