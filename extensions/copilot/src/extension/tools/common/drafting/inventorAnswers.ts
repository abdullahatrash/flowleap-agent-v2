/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Inventor Question answers file (`inventor-answers.md`) of a matter: one section per
 * Inventor Question, for the attorney or the inventor to fill. The save of the draft writes it;
 * code reads the answers from it, never from the chat.
 *
 * ```
 * ## IQ-2
 *
 * **Question:** Which steel grade is the lever made of, and how thick is it?
 *
 * **Belongs:** Detailed Description, after the paragraph on the lever 14.
 *
 * **Answer:**
 * Stainless steel. The thickness is not known.
 *
 * **Narrowed question:** How thick is the lever?
 *
 * **Answer:**
 * ```
 *
 * An answer runs from its `**Answer:**` line to the next field line (`**Question:**`,
 * `**Narrowed question:**`, `**Belongs:**`, `**Answer:**`) or the next `## IQ-<n>` section; any
 * other line, a heading or a note included, is part of it. An empty answer, "Not stated" or
 * "unknown" is no answer. A paragraph of the draft that carries the inventor's answer has the
 * marker `<!-- src: inventor:IQ-2 -->`.
 *
 * The save edits the file in place and never rewrites what the attorney or the inventor wrote: it
 * appends the sections of new questions, updates the text of a question whose current answer is
 * empty, and, when the save applies the current answer (the draft text that cites it changed) while
 * the question stays in the draft, appends the narrowed question with a new empty slot.
 */

import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftParagraph, InventorQuestion, parseDraftParagraphs } from './sourceMarkers';

/** One question of a section and its answer: the first question, or a narrowed one. */
export interface InventorAnswerRound {
	readonly question: string;
	/** The answer text, trimmed; empty when the slot is empty. */
	readonly answer: string;
	/** The 1-based line of the `**Answer:**` slot in the file; absent for a round without a slot. */
	readonly answerLine?: number;
}

/** The section of one Inventor Question. The last round is the current one. */
export interface InventorAnswerSection {
	readonly id: string;
	readonly belongs?: string;
	readonly rounds: readonly InventorAnswerRound[];
}

const answersFile = DRAFTING_FILE_NAMES.inventorAnswers;

/** Answers that state no fact: the question stays open. */
const noAnswers = new Set(['', 'not stated', 'unknown', 'not known', 'n/a']);

/** True when an answer states something: not empty, not "Not stated", not "unknown". */
export function isAnswered(answer: string): boolean {
	return !noAnswers.has(answer.trim().replace(/[.*_]+$/, '').replace(/^[*_]+/, '').trim().toLowerCase());
}

/** The current round of a section: its last round. */
export function currentRound(section: InventorAnswerSection | undefined): InventorAnswerRound | undefined {
	return section?.rounds.at(-1);
}

/** The current answer of a section: the answer of its last round. */
export function currentAnswer(section: InventorAnswerSection | undefined): string {
	return currentRound(section)?.answer ?? '';
}

/** True when some round of the section has an answer: an `inventor:IQ-n` marker may cite it. */
export function hasAnyAnswer(section: InventorAnswerSection | undefined): boolean {
	return !!section?.rounds.some(round => isAnswered(round.answer));
}

/** The question ids that paragraphs of the draft cite with an `inventor:IQ-n` marker. */
export function citedInventorAnswers(paragraphs: readonly DraftParagraph[]): Set<string> {
	return new Set(citedText(paragraphs).keys());
}

/** The text of the paragraphs that cite each question id, joined. */
function citedText(paragraphs: readonly DraftParagraph[]): Map<string, string> {
	const texts = new Map<string, string>();
	for (const paragraph of paragraphs) {
		for (const source of paragraph.sources ?? []) {
			if (source.kind === 'inventor' && source.ref) {
				texts.set(source.ref, [texts.get(source.ref), paragraph.text].filter(Boolean).join('\n\n'));
			}
		}
	}
	return texts;
}

/**
 * The question ids whose cited text (the paragraphs with `inventor:IQ-n`) the draft adds or
 * changes against the previously saved draft: the answers this save applies.
 */
export function newlyAppliedAnswers(previousDraft: string | undefined, draft: string): Set<string> {
	const before = citedText(previousDraft === undefined ? [] : parseDraftParagraphs(previousDraft));
	return new Set([...citedText(parseDraftParagraphs(draft))].filter(([id, text]) => before.get(id) !== text).map(([id]) => id));
}

interface ParsedRound {
	question: string;
	/** 0-based line index of the question field. */
	questionLine?: number;
	/** 0-based line index of the answer field. */
	answerLine?: number;
	readonly answerLines: string[];
}

interface ParsedSection {
	readonly id: string;
	/** 0-based line index of the `## IQ-<n>` heading. */
	readonly start: number;
	/** 0-based line index after the section. */
	end: number;
	belongs?: string;
	belongsLine?: number;
	readonly rounds: ParsedRound[];
}

const sectionPattern = /^##\s+(?<id>IQ-\d+)\s*$/;
const fieldPattern = /^\*\*(?<label>Question|Narrowed question|Belongs|Answer):\*\*\s*(?<value>.*)$/;

function parseLines(lines: readonly string[]): ParsedSection[] {
	const sections: ParsedSection[] = [];
	let round: ParsedRound | undefined;
	let inAnswer = false;
	lines.forEach((content, index) => {
		const heading = sectionPattern.exec(content);
		if (heading?.groups) {
			const previous = sections.at(-1);
			if (previous) {
				previous.end = index;
			}
			sections.push({ id: heading.groups.id, start: index, end: lines.length, rounds: [] });
			round = undefined;
			inAnswer = false;
			return;
		}
		const section = sections.at(-1);
		if (!section) {
			return;
		}
		const field = fieldPattern.exec(content);
		const label = field?.groups?.label;
		const value = field?.groups?.value.trim() ?? '';
		if (label === 'Question' || label === 'Narrowed question') {
			round = { question: value, questionLine: index, answerLines: [] };
			section.rounds.push(round);
			inAnswer = false;
		} else if (label === 'Belongs') {
			section.belongs = value || undefined;
			section.belongsLine = index;
			inAnswer = false;
		} else if (label === 'Answer') {
			if (!round || round.answerLine !== undefined) {
				round = { question: '', answerLines: [] };
				section.rounds.push(round);
			}
			round.answerLine = index;
			round.answerLines.push(value);
			inAnswer = true;
		} else if (inAnswer && round) {
			round.answerLines.push(content);
		}
	});
	return sections;
}

function toSection(section: ParsedSection): InventorAnswerSection {
	return {
		id: section.id,
		...(section.belongs ? { belongs: section.belongs } : {}),
		rounds: section.rounds.map(round => ({
			question: round.question,
			answer: round.answerLines.join('\n').trim(),
			...(round.answerLine !== undefined ? { answerLine: round.answerLine + 1 } : {}),
		})),
	};
}

function splitLines(text: string): string[] {
	return text.replace(/\r\n/g, '\n').split('\n');
}

/** Parses `inventor-answers.md`. */
export function parseInventorAnswers(text: string): InventorAnswerSection[] {
	return parseLines(splitLines(text)).map(toSection);
}

function headerLines(matter: string): string[] {
	return [
		`# Inventor answers: ${matter}`,
		'',
		'Write the inventor\'s answer under each **Answer:**. Leave it empty, or write "Not stated", when the inventor does not know. Then tell the agent: "Apply the answers". The agent copies each answer into the draft; it never answers a question itself.',
	];
}

function newSectionLines(question: InventorQuestion): string[] {
	return [`## ${question.id}`, '', `**Question:** ${question.text}`, '', `**Belongs:** ${question.belongs ?? 'see the question'}`, '', '**Answer:**'];
}

/** The 0-based line index after the last non-blank line of a section. */
function contentEnd(lines: readonly string[], section: ParsedSection): number {
	let end = section.end;
	while (end > section.start + 1 && !lines[end - 1].trim()) {
		end--;
	}
	return end;
}

/**
 * The answers file after a save of the draft, edited in place: a new section for each new
 * question; the question text (and, for a first question, its place) of a section whose current
 * answer is empty takes the draft's; a section whose current answer is filled and applied by this
 * save while the question stays in the draft gets the narrowed question with a new empty slot.
 * Every other line, filled answers and notes included, stays as it is.
 */
export function updateInventorAnswers(previous: string | undefined, matter: string, questions: readonly InventorQuestion[], applied: ReadonlySet<string>): string {
	const lines = previous === undefined ? headerLines(matter) : splitLines(previous);
	const sections = parseLines(lines);
	const inserts: { readonly at: number; readonly lines: readonly string[] }[] = [];
	const appended: string[][] = [];
	for (const question of questions) {
		const section = sections.find(candidate => candidate.id === question.id);
		const round = section?.rounds.at(-1);
		if (!section) {
			appended.push(newSectionLines(question));
		} else if (!round) {
			continue;
		} else if (isAnswered(round.answerLines.join('\n'))) {
			if (applied.has(question.id)) {
				inserts.push({ at: contentEnd(lines, section), lines: ['', `**Narrowed question:** ${question.text}`, '', '**Answer:**'] });
			}
		} else {
			if (round.questionLine !== undefined && round.question !== question.text) {
				lines[round.questionLine] = `**${section.rounds.length > 1 ? 'Narrowed question' : 'Question'}:** ${question.text}`;
			}
			if (section.rounds.length === 1 && question.belongs && section.belongsLine !== undefined && section.belongs !== question.belongs) {
				lines[section.belongsLine] = `**Belongs:** ${question.belongs}`;
			}
		}
	}
	for (const insert of inserts.sort((a, b) => b.at - a.at)) {
		lines.splice(insert.at, 0, ...insert.lines);
	}
	while (lines.length && !lines[lines.length - 1].trim()) {
		lines.pop();
	}
	for (const section of appended) {
		lines.push('', ...section);
	}
	return lines.join('\n') + '\n';
}

/** The Working Record value of one applied answer: `IQ-2, answer 1, from inventor-answers.md`. */
export function appliedAnswerLabel(id: string, round: number): string {
	return `${id}, answer ${round}, from ${answersFile}`;
}
