/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Drafting Checklist (`checklist.md`) of a matter: numbered steps that follow the skill steps
 * and the gates, each `[x]` only when the files say so, each open step with the file, the line and
 * the text to write, and one "Next step for you:" line. Code writes it from the files after every
 * drafting tool call; the model never writes it.
 *
 * ```
 * # Drafting checklist: hinge (EPO)
 *
 * - [x] 1. Feature List confirmed: feature-list.md has `confirmed: true`
 * - [ ] 4. Answer the Inventor Questions: 9 open
 *       → Fill each **Answer:** in inventor-answers.md (lines 9, 17), or send the file to the inventor
 *       → Then tell the agent: "Apply the answers"
 *
 * Next step for you: step 4.
 * ```
 */

import { isInventorQuestion } from './finding';
import { parseFindingsFileItems } from './findingsFile';
import { DRAFTING_FILE_NAMES, DRAFTING_STYLE_FOLDER } from './folderContract';
import { DraftingGateFlag, DraftingOffice, parseDraftingFrontmatter, readGateFlag, readOffice } from './frontmatter';
import { currentAnswer, isAnswered, parseInventorAnswers } from './inventorAnswers';
import { parseInventorQuestions } from './sourceMarkers';
import { MAX_STYLE_EXEMPLARS, STYLE_INSTRUCTION } from './styleFolder';

/** The file contents of one matter that the checklist reads; absent = the file does not exist. */
export interface DraftingChecklistFiles {
	readonly matter: string;
	readonly featureList?: string;
	readonly claims?: string;
	readonly draft?: string;
	readonly inventorAnswers?: string;
	readonly findings?: string;
	/** True when `findings.md` was written by a validator run over the current draft text. */
	readonly findingsCurrent: boolean;
	/** True when the .docx files of the export exist. */
	readonly exported: boolean;
	/** The style exemplars in the workspace `style/` folder; absent when not counted. */
	readonly styleExemplars?: number;
}

/** The step numbers of the checklist. */
export const CHECKLIST_STEP = { featureList: 1, claims: 2, draft: 3, inventorQuestions: 4, errors: 5, export: 6 } as const;

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

/** The checklist of one matter. */
export interface DraftingChecklist {
	readonly matter: string;
	readonly office?: DraftingOffice;
	readonly steps: readonly DraftingChecklistStep[];
	/** The style exemplars in `style/`: an optional step that never blocks. */
	readonly styleExemplars?: number;
}

const files = DRAFTING_FILE_NAMES;

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
function gateStep(number: number, title: string, file: string, text: string, flag: DraftingGateFlag): DraftingChecklistStep {
	const line = fieldLine(text, flag);
	return line === undefined
		? step(number, title, `${file} has no \`${flag}\` flag`, [`→ Review ${file}, then add to its frontmatter (between the \`---\` lines at the top):   ${flag}: true`])
		: step(number, title, `${file} has no \`${flag}: true\``, [`→ Review ${file}, then on line ${line} write:   ${flag}: true`]);
}

/** Reads the checklist of a matter from its files. */
export function readDraftingChecklist(input: DraftingChecklistFiles): DraftingChecklist {
	const featureFields = input.featureList !== undefined ? parseDraftingFrontmatter(input.featureList).fields : {};
	const office = (input.draft !== undefined ? readOffice(parseDraftingFrontmatter(input.draft).fields) : undefined) ?? readOffice(featureFields);
	const steps: DraftingChecklistStep[] = [];

	const featureTitle = 'Confirm the Feature List';
	if (input.featureList === undefined) {
		steps.push(step(1, featureTitle, `${files.featureList} does not exist`, ['→ Tell the agent: "Build the Feature List from the disclosure"']));
	} else if (readGateFlag(featureFields, 'confirmed') !== 'set') {
		steps.push(gateStep(1, featureTitle, files.featureList, input.featureList, 'confirmed'));
	} else if (!readOffice(featureFields)) {
		steps.push(step(1, featureTitle, `${files.featureList} names no office`, [`→ Add to the frontmatter of ${files.featureList}:   office: US   (or   office: EPO)`]));
	} else {
		steps.push(done(1, 'Feature List confirmed', `${files.featureList} has \`confirmed: true\``));
	}
	const featureListOpen = !steps[0].done;

	const claimsTitle = 'Approve the claims';
	if (input.claims === undefined) {
		steps.push(step(2, claimsTitle, `${files.claims} does not exist`, ['→ Tell the agent: "Draft the claims"'], featureListOpen ? [1] : []));
	} else if (readGateFlag(parseDraftingFrontmatter(input.claims).fields, 'approved') !== 'set') {
		steps.push(gateStep(2, claimsTitle, files.claims, input.claims, 'approved'));
	} else {
		steps.push(done(2, 'Claims approved', `${files.claims} has \`approved: true\``));
	}

	const gatesOpen = steps.filter(entry => !entry.done).map(entry => entry.step);
	if (input.draft === undefined) {
		steps.push(step(3, 'Write the draft', `${files.draft} does not exist`, ['→ Tell the agent: "Draft the application"'], gatesOpen));
	} else {
		steps.push(done(3, 'Draft written', files.draft));
	}

	const noDraft = input.draft === undefined ? [3] : [];
	const findingsItems = input.findings !== undefined ? parseFindingsFileItems(input.findings) : [];
	steps.push(questionsStep(input, findingsItems, noDraft));

	const errorsTitle = 'Fix or waive the Errors';
	const validate = '→ Tell the agent: "Validate the draft"';
	if (noDraft.length) {
		steps.push(step(5, errorsTitle, '', [], noDraft));
	} else if (input.findings === undefined) {
		steps.push(step(5, errorsTitle, 'not checked yet', [validate]));
	} else if (!input.findingsCurrent) {
		steps.push(step(5, errorsTitle, `${files.findings} is older than the draft`, [validate]));
	} else {
		const errors = findingsItems.filter(item => item.finding.severity === 'Error' && !isInventorQuestion(item.finding) && !item.finding.waived);
		steps.push(errors.length
			? step(5, errorsTitle, `${errors.length} open (${files.findings} ${lineList(errors.map(item => item.fileLine))})`, [
				'→ To waive, add under the item:   - Waived: <your reason>',
				`→ To fix, tell the agent: "Fix the Errors in ${files.findings}"`,
			])
			: done(5, 'Errors fixed or waived', `none open in ${files.findings}`));
	}

	const exportBlockers = steps.filter(entry => !entry.done).map(entry => entry.step);
	steps.push(input.exported
		? done(6, 'Exported to Word', [files.descriptionDocx, files.claimsDocx, files.abstractDocx].join(', '))
		: step(6, 'Export to Word', 'ready', ['→ Tell the agent: "Export to Word"'], exportBlockers));

	return { matter: input.matter, ...(office ? { office } : {}), steps, ...(input.styleExemplars !== undefined ? { styleExemplars: input.styleExemplars } : {}) };
}

/** Step 4: the Inventor Questions still in the draft, open or answered but not yet applied. */
function questionsStep(input: DraftingChecklistFiles, findingsItems: ReturnType<typeof parseFindingsFileItems>, noDraft: readonly number[]): DraftingChecklistStep {
	const title = 'Answer the Inventor Questions';
	if (input.draft === undefined) {
		return step(4, title, '', [], noDraft);
	}
	const waived = new Set(findingsItems
		.filter(item => isInventorQuestion(item.finding) && item.finding.waived)
		.map(item => /Inventor Question (?<id>IQ-\d+)/.exec(item.finding.message)?.groups?.id));
	const questions = parseInventorQuestions(input.draft).filter(question => !waived.has(question.id));
	if (!questions.length) {
		return done(4, 'Inventor Questions answered and applied', `none open in ${files.draft}`);
	}
	const sections = parseInventorAnswers(input.inventorAnswers ?? '');
	const answered = questions.filter(question => isAnswered(currentAnswer(sections.find(section => section.id === question.id))));
	const open = questions.filter(question => !answered.includes(question));
	const apply = '"Apply the answers"';
	const detail = [
		open.length ? `${open.length} open` : undefined,
		answered.length ? `${answered.length} answered but not yet in the draft (${answered.map(question => question.id).join(', ')})` : undefined,
	].filter(Boolean).join(', ');
	if (!open.length) {
		return step(4, title, detail, [`→ Tell the agent: ${apply}`]);
	}
	if (input.inventorAnswers === undefined) {
		return step(4, title, detail, [`→ ${files.inventorAnswers} does not exist. Tell the agent: "Save the draft" to write it`]);
	}
	const slots = open.map(question => sections.find(section => section.id === question.id)?.rounds.at(-1)?.answerLine).filter((line): line is number => line !== undefined);
	return step(4, title, detail, [
		`→ Fill each **Answer:** in ${files.inventorAnswers}${slots.length ? ` (${lineList(slots)})` : ''}, or send the file to the inventor`,
		`→ Then tell the agent: ${apply}`,
	]);
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
		'Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names.',
		'',
		...checklist.steps.flatMap(entry => [
			`- [${entry.done ? 'x' : ' '}] ${entry.step}. ${entry.title}${entry.detail ? `: ${entry.detail}` : ''}`,
			...entry.actions.map(action => `      ${action}`),
		]),
		...(checklist.styleExemplars !== undefined ? [
			`- Optional. Style exemplars: ${checklist.styleExemplars} file${checklist.styleExemplars === 1 ? '' : 's'} in ${DRAFTING_STYLE_FOLDER}/${checklist.styleExemplars > MAX_STYLE_EXEMPLARS ? ` (only the first ${MAX_STYLE_EXEMPLARS} are read)` : ''}`,
			`      → ${STYLE_INSTRUCTION}`,
		] : []),
		'',
		next ? `Next step for you: step ${next.step}.` : 'Next step for you: none. Review the Word files: they are a draft for attorney review, not a filing.',
	];
	return lines.join('\n') + '\n';
}
