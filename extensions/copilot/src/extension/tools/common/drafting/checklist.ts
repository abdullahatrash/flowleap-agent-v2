/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Drafting Checklist (`checklist.md`) of a matter: six numbered steps with the numbers and
 * names of the application-drafting skill steps (1 Intake, 2 Claims, 3 Draft, 4 Validate,
 * 5 Inventor Questions, 6 Export), each `[x]` only when the files say so, each open step with the
 * file, the line and the text to write, then the notes that never block (figures, required
 * sections, style exemplars), and one "Next step for you:" line. Code writes it from the files
 * after every drafting tool call; the model never writes it.
 *
 * ```
 * # Drafting checklist: hinge (EPO)
 *
 * - [x] 1. Feature List confirmed: feature-list.md has `confirmed: true`
 * - [ ] 5. Answer the Inventor Questions: 9 open
 *       → Fill each **Answer:** in inventor-answers.md (lines 9, 17), or send the file to the inventor
 *       → Then tell the agent: "Apply the answers"
 *
 * Not blocking:
 * - Figures: 10 in figures.md
 *
 * Next step for you: step 5.
 * ```
 */

import { isInventorQuestion } from './finding';
import { FindingsFileItem, parseFindingsFileItems } from './findingsFile';
import { missingParts } from './filingDocuments';
import { DRAFTING_FILE_NAMES, DRAFTING_STYLE_FOLDER } from './folderContract';
import { DraftingGateFlag, DraftingOffice, parseDraftingFrontmatter, readGateFlag, readOffice } from './frontmatter';
import { currentAnswer, currentRound, isAnswered, parseInventorAnswers } from './inventorAnswers';
import { parseInventorQuestions } from './sourceMarkers';
import { parseFigureSections } from './specValidators';
import { MAX_STYLE_EXEMPLARS, STYLE_INSTRUCTION } from './styleFolder';

/** The file contents and states of one matter that the checklist reads; absent = the file does not exist. */
export interface DraftingChecklistFiles {
	readonly matter: string;
	readonly featureList?: string;
	readonly claims?: string;
	/** True when `claims.md` is approved but its body changed after the approval (`approvedHash`). */
	readonly claimsChangedSinceApproval?: boolean;
	readonly draft?: string;
	/** True when the saved draft was generated against other claims than the current `claims.md`. */
	readonly draftStale?: boolean;
	readonly figures?: string;
	readonly inventorAnswers?: string;
	readonly findings?: string;
	/** True when `findings.md` was written by a validator run over the current draft and claims. */
	readonly findingsCurrent: boolean;
	/** True when the export files were written from the current draft. */
	readonly exported: boolean;
	/** The style exemplars in the workspace `style/` folder; absent when not counted. */
	readonly styleExemplars?: number;
}

/** The step numbers of the checklist: the numbers of the application-drafting skill steps. */
export const CHECKLIST_STEP = { featureList: 1, claims: 2, draft: 3, errors: 4, inventorQuestions: 5, export: 6 } as const;

/** The names of the checklist notes, which never block; the full review copy points to them. */
export const CHECKLIST_NOTE = { figures: 'Figures', sections: 'Required sections', style: 'Style exemplars' } as const;

/** One step of the checklist. */
export interface DraftingChecklistStep {
	readonly step: number;
	readonly done: boolean;
	/** The name of the step, e.g. "Answer the Inventor Questions". */
	readonly title: string;
	/** The state after the name, e.g. "9 open". */
	readonly detail: string;
	/** What to do, one line each; empty for a done step. */
	readonly actions: readonly string[];
	/** The open earlier steps this step waits for. */
	readonly blockedBy: readonly number[];
}

/** One note of the checklist: a state that never blocks, with what to do about it. */
export interface DraftingChecklistNote {
	readonly name: string;
	readonly detail: string;
	readonly actions: readonly string[];
}

/** The checklist of one matter. */
export interface DraftingChecklist {
	readonly matter: string;
	readonly office?: DraftingOffice;
	readonly steps: readonly DraftingChecklistStep[];
	readonly notes: readonly DraftingChecklistNote[];
}

function stepList(steps: readonly number[]): string {
	const numbers = steps.map(String);
	return numbers.length === 1 ? `step ${numbers[0]}` : `steps ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

function lineList(lines: readonly number[]): string {
	return lines.length === 1 ? `line ${lines[0]}` : `lines ${lines.join(', ')}`;
}

/** The 1-based line of a frontmatter field, or `undefined` when the frontmatter has no such field. */
function fieldLine(text: string, field: string): number | undefined {
	const { bodyStartLine } = parseDraftingFrontmatter(text);
	const lines = text.replace(/\r\n/g, '\n').split('\n').slice(0, bodyStartLine - 1);
	const index = lines.findIndex(content => new RegExp(`^${field}\\s*:`).test(content));
	return index < 0 ? undefined : index + 1;
}

function step(number: number, title: string, detail: string, actions: readonly string[] = [], blockedBy: readonly number[] = []): DraftingChecklistStep {
	return { step: number, done: false, title, detail: blockedBy.length ? `blocked by ${stepList(blockedBy)}` : detail, actions: blockedBy.length ? [] : actions, blockedBy };
}

function done(number: number, title: string, detail: string): DraftingChecklistStep {
	return { step: number, done: true, title, detail, actions: [], blockedBy: [] };
}

/** The open step of a gate flag the attorney sets: names the file, the line and the text. */
function gateStep(number: number, title: string, file: string, text: string, flag: DraftingGateFlag, detail?: string): DraftingChecklistStep {
	const line = fieldLine(text, flag);
	return line === undefined
		? step(number, title, detail ?? `${file} has no \`${flag}\` flag`, [`→ Review ${file}, then add to its frontmatter (between the \`---\` lines at the top):   ${flag}: true`])
		: step(number, title, detail ?? `${file} has no \`${flag}: true\``, [`→ Review ${file}, then on line ${line} write:   ${flag}: true`]);
}

const openSteps = (steps: readonly DraftingChecklistStep[]) => steps.filter(entry => !entry.done).map(entry => entry.step);

/** Reads the checklist of a matter from its files. */
export function readDraftingChecklist(input: DraftingChecklistFiles): DraftingChecklist {
	const { featureList: featureListStep, claims: claimsStep, draft: draftStep, errors: errorsStep, export: exportStep } = CHECKLIST_STEP;
	const featureFields = input.featureList !== undefined ? parseDraftingFrontmatter(input.featureList).fields : {};
	const office = (input.draft !== undefined ? readOffice(parseDraftingFrontmatter(input.draft).fields) : undefined) ?? readOffice(featureFields);
	const steps: DraftingChecklistStep[] = [];

	const featureTitle = 'Confirm the Feature List';
	if (input.featureList === undefined) {
		steps.push(step(featureListStep, featureTitle, `${DRAFTING_FILE_NAMES.featureList} does not exist`, ['→ Tell the agent: "Build the Feature List from the disclosure"']));
	} else if (readGateFlag(featureFields, 'confirmed') !== 'set') {
		steps.push(gateStep(featureListStep, featureTitle, DRAFTING_FILE_NAMES.featureList, input.featureList, 'confirmed'));
	} else if (!readOffice(featureFields)) {
		steps.push(step(featureListStep, featureTitle, `${DRAFTING_FILE_NAMES.featureList} names no office`, [`→ Add to the frontmatter of ${DRAFTING_FILE_NAMES.featureList}:   office: US   (or   office: EPO)`]));
	} else {
		steps.push(done(featureListStep, 'Feature List confirmed', `${DRAFTING_FILE_NAMES.featureList} has \`confirmed: true\``));
	}

	const claimsTitle = 'Approve the claims';
	if (input.claims === undefined) {
		steps.push(step(claimsStep, claimsTitle, `${DRAFTING_FILE_NAMES.claims} does not exist`, ['→ Tell the agent: "Draft the claims"'], openSteps(steps)));
	} else if (readGateFlag(parseDraftingFrontmatter(input.claims).fields, 'approved') !== 'set') {
		steps.push(gateStep(claimsStep, claimsTitle, DRAFTING_FILE_NAMES.claims, input.claims, 'approved'));
	} else if (input.claimsChangedSinceApproval) {
		steps.push(gateStep(claimsStep, claimsTitle, DRAFTING_FILE_NAMES.claims, input.claims, 'approved', `${DRAFTING_FILE_NAMES.claims} changed after it was approved`));
	} else {
		steps.push(done(claimsStep, 'Claims approved', `${DRAFTING_FILE_NAMES.claims} has \`approved: true\``));
	}

	const draftTitle = 'Write the draft';
	if (input.draft === undefined) {
		steps.push(step(draftStep, draftTitle, `${DRAFTING_FILE_NAMES.draft} does not exist`, ['→ Tell the agent: "Draft the application"'], openSteps(steps)));
	} else if (input.draftStale) {
		steps.push(step(draftStep, draftTitle, `${DRAFTING_FILE_NAMES.draft} was written for other claims than ${DRAFTING_FILE_NAMES.claims}`, ['→ Tell the agent: "Draft the application again"'], openSteps(steps)));
	} else {
		steps.push(done(draftStep, 'Draft written', DRAFTING_FILE_NAMES.draft));
	}

	const noDraft = input.draft === undefined ? [draftStep] : [];
	const findingsItems = input.findings !== undefined ? parseFindingsFileItems(input.findings) : [];
	const errorsTitle = 'Fix or waive the Errors';
	const validate = '→ Tell the agent: "Validate the draft"';
	if (noDraft.length) {
		steps.push(step(errorsStep, errorsTitle, '', [], noDraft));
	} else if (input.findings === undefined) {
		steps.push(step(errorsStep, errorsTitle, 'not checked yet', [validate]));
	} else if (!input.findingsCurrent) {
		steps.push(step(errorsStep, errorsTitle, `${DRAFTING_FILE_NAMES.findings} is older than the draft or the claims`, [validate]));
	} else {
		const errors = findingsItems.filter(item => item.finding.severity === 'Error' && !isInventorQuestion(item.finding) && !item.finding.waived);
		steps.push(errors.length
			? step(errorsStep, errorsTitle, `${errors.length} open (${DRAFTING_FILE_NAMES.findings} ${lineList(errors.map(item => item.fileLine))})`, [
				'→ To waive, add under the item:   - Waived: <your reason>',
				`→ To fix, tell the agent: "Fix the Errors in ${DRAFTING_FILE_NAMES.findings}"`,
			])
			: done(errorsStep, 'Errors fixed or waived', `none open in ${DRAFTING_FILE_NAMES.findings}`));
	}

	steps.push(questionsStep(input, findingsItems, noDraft));

	const blockers = openSteps(steps);
	steps.push(input.exported && !blockers.length
		? done(exportStep, 'Exported to Word', [DRAFTING_FILE_NAMES.descriptionDocx, DRAFTING_FILE_NAMES.claimsDocx, DRAFTING_FILE_NAMES.abstractDocx].join(', '))
		: step(exportStep, 'Export to Word', 'ready', ['→ Tell the agent: "Export to Word"'], blockers));

	return { matter: input.matter, ...(office ? { office } : {}), steps, notes: checklistNotes(input, office) };
}

/** Step 5: the Inventor Questions open, answered but not yet applied, or removed from the draft without an answer. */
function questionsStep(input: DraftingChecklistFiles, findingsItems: readonly FindingsFileItem[], noDraft: readonly number[]): DraftingChecklistStep {
	const number = CHECKLIST_STEP.inventorQuestions;
	const title = 'Answer the Inventor Questions';
	if (input.draft === undefined) {
		return step(number, title, '', [], noDraft);
	}
	const waived = new Set(findingsItems.filter(item => isInventorQuestion(item.finding) && item.finding.waived).map(item => item.finding.question));
	const sections = parseInventorAnswers(input.inventorAnswers ?? '');
	const inDraft = parseInventorQuestions(input.draft).map(question => question.id);
	const ids = [...inDraft, ...sections.filter(section => !inDraft.includes(section.id) && !isAnswered(currentAnswer(section))).map(section => section.id)]
		.filter(id => !waived.has(id));
	if (!ids.length) {
		return done(number, 'Inventor Questions answered and applied', waived.size
			? `${waived.size} waived in ${DRAFTING_FILE_NAMES.findings}, none open`
			: `none open in ${DRAFTING_FILE_NAMES.draft}`);
	}
	const section = (id: string) => sections.find(candidate => candidate.id === id);
	const answered = ids.filter(id => inDraft.includes(id) && isAnswered(currentAnswer(section(id))));
	const open = ids.filter(id => !answered.includes(id));
	const removed = open.filter(id => !inDraft.includes(id));
	const apply = '"Apply the answers"';
	const detail = [
		open.length ? `${open.length} open` : undefined,
		removed.length ? `${removed.length} removed from the draft without an answer (${removed.join(', ')})` : undefined,
		answered.length ? `${answered.length} answered but not yet in the draft (${answered.join(', ')})` : undefined,
	].filter(Boolean).join(', ');
	if (!open.length) {
		return step(number, title, detail, [`→ Tell the agent: ${apply}`]);
	}
	if (input.inventorAnswers === undefined) {
		return step(number, title, detail, [`→ ${DRAFTING_FILE_NAMES.inventorAnswers} does not exist. Tell the agent: "Save the draft" to write it`]);
	}
	const slots = open.map(id => currentRound(section(id))?.answerLine).filter((line): line is number => line !== undefined);
	return step(number, title, detail, [
		`→ Fill each **Answer:** in ${DRAFTING_FILE_NAMES.inventorAnswers}${slots.length ? ` (${lineList(slots)})` : ''}, or send the file to the inventor`,
		`→ Then tell the agent: ${apply}`,
	]);
}

/** The notes of the checklist: figures, required sections of the office, style exemplars. */
function checklistNotes(input: DraftingChecklistFiles, office: DraftingOffice | undefined): DraftingChecklistNote[] {
	const notes: DraftingChecklistNote[] = [];
	const figures = parseFigureSections(input.figures ?? '').figures;
	const figureCount = figures.reduce((sum, figure) => sum + figure.count, 0);
	notes.push(input.figures === undefined || !figureCount
		? { name: CHECKLIST_NOTE.figures, detail: input.figures === undefined ? `${DRAFTING_FILE_NAMES.figures} does not exist` : `none in ${DRAFTING_FILE_NAMES.figures}`, actions: [`→ When the application has drawings, add one heading per figure to ${DRAFTING_FILE_NAMES.figures} (e.g. "## FIG. 1") with its parts, or tell the agent: "Build figures.md from the disclosure"`] }
		: { name: CHECKLIST_NOTE.figures, detail: `${figureCount} in ${DRAFTING_FILE_NAMES.figures}`, actions: [] });
	if (input.draft !== undefined && office) {
		const missing = missingParts(input.draft, office, figureCount > 0);
		notes.push(missing.length
			? { name: CHECKLIST_NOTE.sections, detail: `missing in ${DRAFTING_FILE_NAMES.draft}: ${missing.join(', ')}`, actions: [`→ Tell the agent: "Add the missing sections: ${missing.join(', ')}"`] }
			: { name: CHECKLIST_NOTE.sections, detail: `all in ${DRAFTING_FILE_NAMES.draft}`, actions: [] });
	}
	if (input.styleExemplars !== undefined) {
		const count = input.styleExemplars;
		notes.push({ name: CHECKLIST_NOTE.style, detail: `${count} file${count === 1 ? '' : 's'} in ${DRAFTING_STYLE_FOLDER}/${count > MAX_STYLE_EXEMPLARS ? ` (only the first ${MAX_STYLE_EXEMPLARS} are read)` : ''}`, actions: [`→ ${STYLE_INSTRUCTION}`] });
	}
	return notes;
}

/** The open steps a tool refusal points to: every open step before the export that waits for no other step. */
export function checklistPointer(checklist: DraftingChecklist, path: string): string {
	const open = checklist.steps.filter(entry => !entry.done && !entry.blockedBy.length && entry.step !== CHECKLIST_STEP.export);
	return open.length
		? `Open in ${path}: ${open.map(entry => `step ${entry.step} (${entry.title})`).join(', ')}.`
		: `See ${path}.`;
}

/** The first open step that waits for no other step, or `undefined` when every step is done. */
export function nextChecklistStep(checklist: DraftingChecklist): DraftingChecklistStep | undefined {
	return checklist.steps.find(entry => !entry.done && !entry.blockedBy.length);
}

/** Renders `checklist.md`. */
export function renderChecklist(checklist: DraftingChecklist): string {
	const next = nextChecklistStep(checklist);
	const lines = [
		`# Drafting checklist: ${checklist.matter}${checklist.office ? ` (${checklist.office})` : ''}`,
		'',
		'Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names. The step numbers are the steps of the application-drafting skill.',
		'',
		...checklist.steps.flatMap(entry => [
			`- [${entry.done ? 'x' : ' '}] ${entry.step}. ${entry.title}${entry.detail ? `: ${entry.detail}` : ''}`,
			...entry.actions.map(action => `      ${action}`),
		]),
		...(checklist.notes.length ? [
			'',
			'Not blocking:',
			'',
			...checklist.notes.flatMap(note => [`- ${note.name}: ${note.detail}`, ...note.actions.map(action => `      ${action}`)]),
		] : []),
		'',
		next ? `Next step for you: step ${next.step}.` : 'Next step for you: none. Review the Word files: they are a draft for attorney review, not a filing.',
	];
	return lines.join('\n') + '\n';
}
