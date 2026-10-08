/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftingFrontmatterFields, DraftingFrontmatterValue, parseDraftingFrontmatter, readOffice, writeDraftingFrontmatter } from '../common/drafting/frontmatter';
import { addRecordLine, APPROVAL_CLEARED, APPROVED_CLAIMS_HASH, readRecordField, readRecordFields, renderDraftWorkingRecord, resaveWorkingRecord, VERSION_CLAIMS_HASH } from '../common/drafting/workingRecord';
import { DraftingWorkspace } from './draftingWorkspace';

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

function text(value: DraftingFrontmatterValue): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : undefined;
}

function positiveInteger(value: DraftingFrontmatterValue): number | undefined {
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
 * snapshot, and the Working Record with its header and source map.
 *
 * The save refuses while `confirmed` is not `true` in `feature-list.md` or `approved` is not `true`
 * in `claims.md` (ADR 0012: the specification is generated only against approved claims).
 * Findings never block the save.
 *
 * The generated snapshot of a version is written once, at the first save of that version; a later
 * save of the same version keeps it, so the export still diffs the attorney's edits against what
 * was generated, and updates the Working Record (a `Re-saved` line and a fresh source map). When
 * the draft is generated against other claims than the snapshot was, the version goes up by one
 * and the previous draft, snapshot and record are kept as `draft-application.v<n>.*`.
 */
export async function saveDraftApplication(workspace: DraftingWorkspace, input: DraftApplicationSaveInput): Promise<DraftApplicationSaveResult> {
	const { folder } = workspace;
	const { fields } = parseDraftingFrontmatter(input.content);
	const office = readOffice({ office: text(fields.office) ?? input.office });
	const model = text(fields.model) ?? text(input.model);
	const provider = text(fields.provider) ?? text(input.provider);
	if (!office || !model || !provider) {
		const missing = [!office ? 'office (US or EPO)' : undefined, !model ? 'model' : undefined, !provider ? 'provider' : undefined].filter(Boolean);
		return { saved: false, reason: `The draft frontmatter (or the model and provider fields) must name the ${office ? 'model and the provider the disclosure went to' : 'office, the model and the provider'}. Missing: ${missing.join(', ')}.` };
	}

	const featureList = await workspace.requireConfirmedFeatureList();
	if (typeof featureList === 'string') {
		return { saved: false, reason: featureList };
	}
	const approval = await workspace.requireApprovedClaims();
	if (typeof approval === 'string') {
		return { saved: false, reason: approval };
	}

	const currentHash = approval.hash;
	const previousRecord = await workspace.read(folder.workingRecord) ?? '';
	const approvedHash = readRecordField(previousRecord, APPROVED_CLAIMS_HASH);
	const versionHash = approvedHash ?? currentHash;
	const snapshot = await workspace.read(folder.generatedSnapshot);
	const previousVersion = snapshot !== undefined ? positiveInteger(parseDraftingFrontmatter(snapshot).fields.version) ?? 1 : undefined;
	const previousVersionHash = readRecordField(previousRecord, VERSION_CLAIMS_HASH);
	const claimsChanged = previousVersion !== undefined && !!previousVersionHash && previousVersionHash !== versionHash;
	const requested = positiveInteger(fields.version);
	const version = previousVersion !== undefined && claimsChanged ? Math.max(previousVersion + 1, requested ?? 0) : requested ?? previousVersion ?? 1;
	const firstSaveOfVersion = previousVersion === undefined || version !== previousVersion;

	const archived: string[] = [];
	if (previousVersion !== undefined && firstSaveOfVersion) {
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
	const savedAt = new Date().toISOString();
	await workspace.write(folder.draft, document);
	if (firstSaveOfVersion) {
		await workspace.write(folder.generatedSnapshot, document);
	}
	if (firstSaveOfVersion || !previousRecord.trim()) {
		const record = renderDraftWorkingRecord({
			matter: folder.matter,
			office,
			model,
			provider,
			version,
			disclosureVersion: text(input.disclosureVersion),
			promptsSummary: text(input.promptsSummary),
			savedAt,
			approvedClaimsHash: approvedHash,
			versionClaimsHash: versionHash,
		}, document);
		// The approval history of the claims stays with the record of the draft built on them.
		const cleared = readRecordFields(previousRecord, APPROVAL_CLEARED);
		await workspace.write(folder.workingRecord, cleared.reduce((updated, value) => addRecordLine(updated, APPROVAL_CLEARED, value), record));
	} else {
		await workspace.write(folder.workingRecord, resaveWorkingRecord(previousRecord, document, savedAt));
	}

	const notes = [
		`Saved ${folder.draft} (version ${version}, office ${office}). Generated snapshot: ${folder.generatedSnapshot}${firstSaveOfVersion ? '' : ` (kept from the first save of version ${version})`}. Working record: ${folder.workingRecord}.`,
		archived.length ? `${claimsChanged ? `The claims changed since version ${previousVersion}: this` : 'This'} is version ${version}; the previous files are kept as ${archived.join(', ')}.` : undefined,
		!approvedHash ? `No approved claims were recorded: call start_application_draft before drafting, so the draft is tied to the approved ${folder.claims}.` : undefined,
		approvedHash && approvedHash !== currentHash ? `${folder.claims} was approved again after start_application_draft: this draft is tied to the claims start_application_draft returned. Call start_application_draft, regenerate and save to draft against the current claims.` : undefined,
		'Findings are not checked at save. Call validate_draft next.',
	];
	return { saved: true, message: notes.filter(Boolean).join('\n') };
}
