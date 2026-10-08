/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftingFrontmatterFields, DraftingFrontmatterValue, parseDraftingFrontmatter, readOffice, writeDraftingFrontmatter } from '../common/drafting/frontmatter';
import { appliedAnswerLabel, citedInventorAnswers, lastAnsweredRound, parseInventorAnswers, updateInventorAnswers } from '../common/drafting/inventorAnswers';
import { parseDraftParagraphs, parseInventorQuestions } from '../common/drafting/sourceMarkers';
import { addRecordLine, APPROVAL_CLEARED, APPROVED_CLAIMS_HASH, INVENTOR_ANSWER_APPLIED, readRecordField, readRecordFields, renderDraftWorkingRecord, resaveWorkingRecord, VERSION_CLAIMS_HASH } from '../common/drafting/workingRecord';
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
 *
 * The save writes the Inventor Questions of the draft to `inventor-answers.md` (new questions
 * added, filled answers kept) and records each inventor's answer the draft cites
 * (`inventor:IQ-n`) in the Working Record. After the save, also after a refusal, it writes the
 * Drafting Checklist.
 */
export async function saveDraftApplication(workspace: DraftingWorkspace, input: DraftApplicationSaveInput): Promise<DraftApplicationSaveResult> {
	const result = await save(workspace, input);
	const checklist = await workspace.checklistLine(!result.saved);
	if (!checklist) {
		return result;
	}
	return result.saved ? { saved: true, message: `${result.message}\n${checklist}` } : { saved: false, reason: `${result.reason} ${checklist}` };
}

async function save(workspace: DraftingWorkspace, input: DraftApplicationSaveInput): Promise<DraftApplicationSaveResult> {
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
	let record: string;
	if (firstSaveOfVersion || !previousRecord.trim()) {
		record = renderDraftWorkingRecord({
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
		record = readRecordFields(previousRecord, APPROVAL_CLEARED).reduce((updated, value) => addRecordLine(updated, APPROVAL_CLEARED, value), record);
	} else {
		record = resaveWorkingRecord(previousRecord, document, savedAt);
	}

	// The inventor's answers the draft now cites, each recorded once per answer.
	const previousAnswers = await workspace.read(folder.inventorAnswers);
	const sections = parseInventorAnswers(previousAnswers ?? '');
	const cited = citedInventorAnswers(parseDraftParagraphs(document));
	const recorded = readRecordFields(record, INVENTOR_ANSWER_APPLIED).map(value => value.replace(/ at \S+$/, ''));
	for (const id of cited) {
		const round = lastAnsweredRound(sections.find(section => section.id === id));
		const label = round !== undefined ? appliedAnswerLabel(id, round) : undefined;
		if (label && !recorded.includes(label)) {
			record = addRecordLine(record, INVENTOR_ANSWER_APPLIED, `${label} at ${savedAt}`);
		}
	}
	await workspace.write(folder.workingRecord, record);

	const questions = parseInventorQuestions(document);
	const newQuestions = questions.filter(question => !sections.some(section => section.id === question.id));
	if (questions.length || previousAnswers !== undefined) {
		await workspace.write(folder.inventorAnswers, updateInventorAnswers(previousAnswers, folder.matter, questions, cited));
	}

	const notes = [
		`Saved ${folder.draft} (version ${version}, office ${office}). Generated snapshot: ${folder.generatedSnapshot}${firstSaveOfVersion ? '' : ` (kept from the first save of version ${version})`}. Working record: ${folder.workingRecord}.`,
		archived.length ? `${claimsChanged ? `The claims changed since version ${previousVersion}: this` : 'This'} is version ${version}; the previous files are kept as ${archived.join(', ')}.` : undefined,
		!approvedHash ? `No approved claims were recorded: call start_application_draft before drafting, so the draft is tied to the approved ${folder.claims}.` : undefined,
		questions.length ? `Inventor Questions: ${questions.length} in the draft${newQuestions.length ? `, ${newQuestions.length} new` : ''}; the answer slots are in ${folder.inventorAnswers}.` : undefined,
		approvedHash && approvedHash !== currentHash ? `${folder.claims} was approved again after start_application_draft: this draft is tied to the claims start_application_draft returned. Call start_application_draft, regenerate and save to draft against the current claims.` : undefined,
		'Findings are not checked at save. Call validate_draft next.',
	];
	return { saved: true, message: notes.filter(Boolean).join('\n') };
}
