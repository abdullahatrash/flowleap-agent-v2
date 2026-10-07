/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftingFrontmatterFields, parseDraftingFrontmatter, readOffice, writeDraftingFrontmatter } from '../common/drafting/frontmatter';
import { APPROVED_CLAIMS_HASH, readRecordField, renderDraftWorkingRecord, VERSION_CLAIMS_HASH } from '../common/drafting/workingRecord';
import { claimsHash, DraftingWorkspace } from './draftingWorkspace';

/** The `write_patent_results` input of a `draft-application` save. */
export interface DraftApplicationSaveInput {
	readonly content: string;
	/** Office, model and provider fill the frontmatter fields the content does not have. */
	readonly office?: string;
	readonly model?: string;
	readonly provider?: string;
	readonly disclosureVersion?: string;
	readonly promptsSummary?: string;
}

/** The outcome of a `draft-application` save: the refusal, or what was written. */
export type DraftApplicationSaveResult =
	| { readonly saved: false; readonly reason: string }
	| { readonly saved: true; readonly message: string };

function text(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
	const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isInteger(number) && number > 0 ? number : undefined;
}

/** The archived name of a drafting file of an earlier version: `draft-application.v1.md`. */
function versionedPath(path: string, version: number): string {
	return path.replace(/\/draft-application\./, `/draft-application.v${version}.`);
}

/**
 * Saves a Draft Application (the `draft-application` template of `write_patent_results`): the
 * draft with its frontmatter on line 1 (`office`, `model`, `provider`, `version`), the generated
 * snapshot, and the Working Record with its header and source map. Findings never block the
 * save. When the generated snapshot exists and the draft is generated against other claims than
 * the snapshot was, the version goes up by one and the previous draft, snapshot and record are
 * kept as `draft-application.v<n>.*`.
 */
export async function saveDraftApplication(workspace: DraftingWorkspace, input: DraftApplicationSaveInput): Promise<DraftApplicationSaveResult> {
	const { folder } = workspace;
	const { fields } = parseDraftingFrontmatter(input.content);
	const office = readOffice({ office: text(fields.office) ?? input.office });
	const model = text(fields.model) ?? text(input.model);
	const provider = text(fields.provider) ?? text(input.provider);
	const missing = [!office ? 'office (US or EPO)' : undefined, !model ? 'model' : undefined, !provider ? 'provider' : undefined].filter(Boolean);
	if (missing.length) {
		return { saved: false, reason: `The draft frontmatter (or the model and provider fields) must name the ${office ? 'model and the provider the disclosure went to' : 'office, the model and the provider'}. Missing: ${missing.join(', ')}.` };
	}

	const claims = await workspace.read(folder.claims);
	const currentHash = claims !== undefined ? claimsHash(claims) : undefined;
	const previousRecord = await workspace.read(folder.workingRecord) ?? '';
	const approvedHash = readRecordField(previousRecord, APPROVED_CLAIMS_HASH);
	const versionHash = approvedHash ?? currentHash;
	const snapshot = await workspace.read(folder.generatedSnapshot);
	const previousVersion = snapshot !== undefined ? positiveInteger(parseDraftingFrontmatter(snapshot).fields.version) ?? 1 : undefined;
	const previousVersionHash = readRecordField(previousRecord, VERSION_CLAIMS_HASH);
	const newVersion = previousVersion !== undefined && !!previousVersionHash && !!versionHash && previousVersionHash !== versionHash;
	const requested = positiveInteger(fields.version);
	const version = newVersion ? Math.max(previousVersion + 1, requested ?? 0) : requested ?? previousVersion ?? 1;

	const archived: string[] = [];
	if (newVersion) {
		for (const path of [folder.draft, folder.generatedSnapshot, folder.workingRecord]) {
			const previous = await workspace.read(path);
			if (previous !== undefined) {
				await workspace.write(versionedPath(path, previousVersion), previous);
				archived.push(versionedPath(path, previousVersion));
			}
		}
	}

	const ordered: DraftingFrontmatterFields = { office, model, provider, version };
	const document = writeDraftingFrontmatter({ ...ordered, ...Object.fromEntries(Object.entries(fields).filter(([key]) => !(key in ordered))) }, input.content);
	await workspace.write(folder.draft, document);
	await workspace.write(folder.generatedSnapshot, document);
	await workspace.write(folder.workingRecord, renderDraftWorkingRecord({
		matter: folder.matter,
		office: office!,
		model: model!,
		provider: provider!,
		version,
		disclosureVersion: text(input.disclosureVersion),
		promptsSummary: text(input.promptsSummary),
		savedAt: new Date().toISOString(),
		approvedClaimsHash: approvedHash,
		versionClaimsHash: versionHash,
	}, document));

	const notes = [
		`Saved ${folder.draft} (version ${version}, office ${office}). Generated snapshot: ${folder.generatedSnapshot}. Working record: ${folder.workingRecord}.`,
		archived.length ? `The claims changed since version ${previousVersion}: this is version ${version}; the previous files are kept as ${archived.join(', ')}.` : undefined,
		!approvedHash ? `No approved claims were recorded: call start_application_draft before drafting, so the draft is tied to the approved ${folder.claims}.` : undefined,
		approvedHash && currentHash && approvedHash !== currentHash ? `${folder.claims} changed after start_application_draft: the approval no longer holds, and validate_draft and export_draft_docx will clear \`approved\` and refuse until the attorney approves again.` : undefined,
		'Findings are not checked at save. Call validate_draft next.',
	];
	return { saved: true, message: notes.filter(Boolean).join('\n') };
}
