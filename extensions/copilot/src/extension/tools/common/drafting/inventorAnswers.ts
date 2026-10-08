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
 * Grade 304. The thickness is not known.
 *
 * **Narrowed question:** How thick is the lever?
 *
 * **Answer:**
 * ```
 *
 * An empty answer, "Not stated" or "unknown" is no answer. A paragraph of the draft that carries
 * the inventor's answer has the marker `<!-- src: inventor:IQ-2 -->`. When the answer is applied
 * and the question stays in the draft, the answer was partial: the next save adds the narrowed
 * question with a new empty `**Answer:**` slot. A filled answer is never overwritten.
 */

import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftParagraph, InventorQuestion } from './sourceMarkers';

/** One question of a section and its answer: the first question, or a narrowed one. */
export interface InventorAnswerRound {
	readonly question: string;
	/** The answer text, trimmed; empty when the slot is empty. */
	readonly answer: string;
	/** The 1-based line of the `**Answer:**` slot in the file; absent for a round not yet written. */
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

/** The current answer of a section: the answer of its last round. */
export function currentAnswer(section: InventorAnswerSection | undefined): string {
	return section?.rounds.at(-1)?.answer ?? '';
}

/** True when some round of the section has an answer: an `inventor:IQ-n` marker may cite it. */
export function hasAnyAnswer(section: InventorAnswerSection | undefined): boolean {
	return !!section?.rounds.some(round => isAnswered(round.answer));
}

/** The question ids that paragraphs of the draft cite with an `inventor:IQ-n` marker. */
export function citedInventorAnswers(paragraphs: readonly DraftParagraph[]): Set<string> {
	return new Set(paragraphs.flatMap(paragraph => paragraph.sources ?? []).filter(source => source.kind === 'inventor' && source.ref).map(source => source.ref!));
}

const fieldPattern = /^\*\*(?<label>Question|Narrowed question|Belongs|Answer):\*\*\s*(?<value>.*)$/;

/** Parses `inventor-answers.md`. */
export function parseInventorAnswers(text: string): InventorAnswerSection[] {
	const sections: { id: string; belongs?: string; rounds: { question: string; answer: string[]; answerLine?: number }[] }[] = [];
	let inAnswer = false;
	text.replace(/\r\n/g, '\n').split('\n').forEach((content, index) => {
		const heading = /^##\s+(?<id>IQ-\d+)\s*$/.exec(content);
		if (heading?.groups) {
			sections.push({ id: heading.groups.id, rounds: [] });
			inAnswer = false;
			return;
		}
		const section = sections.at(-1);
		if (!section) {
			return;
		}
		if (/^#{1,6}\s/.test(content)) {
			sections.push({ id: '', rounds: [] });
			inAnswer = false;
			return;
		}
		const field = fieldPattern.exec(content);
		const label = field?.groups?.label;
		const value = field?.groups?.value.trim() ?? '';
		if (label === 'Question' || label === 'Narrowed question') {
			section.rounds.push({ question: value, answer: [] });
			inAnswer = false;
		} else if (label === 'Belongs') {
			section.belongs = value || undefined;
			inAnswer = false;
		} else if (label === 'Answer') {
			if (!section.rounds.length || section.rounds.at(-1)!.answerLine !== undefined) {
				section.rounds.push({ question: '', answer: [] });
			}
			const round = section.rounds.at(-1)!;
			round.answerLine = index + 1;
			round.answer.push(value);
			inAnswer = true;
		} else if (inAnswer) {
			section.rounds.at(-1)!.answer.push(content);
		}
	});
	return sections.filter(section => section.id).map(section => ({
		id: section.id,
		...(section.belongs ? { belongs: section.belongs } : {}),
		rounds: section.rounds.map(round => ({ question: round.question, answer: round.answer.join('\n').trim(), ...(round.answerLine !== undefined ? { answerLine: round.answerLine } : {}) })),
	}));
}

/** Renders `inventor-answers.md` from its sections, in the order given. */
export function renderInventorAnswers(matter: string, sections: readonly InventorAnswerSection[]): string {
	const lines = [
		`# Inventor answers: ${matter}`,
		'',
		'Write the inventor\'s answer under each **Answer:**. Leave it empty, or write "Not stated", when the inventor does not know. Then tell the agent: "Apply the answers". The agent copies each answer into the draft; it never answers a question itself.',
	];
	for (const section of sections) {
		lines.push('', `## ${section.id}`);
		section.rounds.forEach((round, index) => {
			lines.push('', `**${index ? 'Narrowed question' : 'Question'}:** ${round.question}`);
			if (!index) {
				lines.push('', `**Belongs:** ${section.belongs ?? 'see the question'}`);
			}
			lines.push('', '**Answer:**', ...(round.answer ? [round.answer] : []));
		});
	}
	return lines.join('\n') + '\n';
}

/**
 * The answers file after a save of the draft: a new section for each new question; a section
 * whose current answer is empty takes the question text and place of the draft; a section whose
 * current answer is filled and cited in the draft (`inventor:IQ-n`) while the question is still in
 * the draft gets the narrowed question with a new empty slot. Filled answers and sections of
 * questions no longer in the draft are kept as they are.
 */
export function updateInventorAnswers(previous: string | undefined, matter: string, questions: readonly InventorQuestion[], cited: ReadonlySet<string>): string {
	const sections = parseInventorAnswers(previous ?? '');
	for (const question of questions) {
		const index = sections.findIndex(section => section.id === question.id);
		const section = sections[index];
		if (!section) {
			sections.push({ id: question.id, ...(question.belongs ? { belongs: question.belongs } : {}), rounds: [{ question: question.text, answer: '' }] });
			continue;
		}
		const rounds = section.rounds.length ? section.rounds : [{ question: question.text, answer: '' }];
		const current = rounds.at(-1)!;
		if (isAnswered(current.answer)) {
			if (cited.has(question.id)) {
				sections[index] = { ...section, rounds: [...rounds, { question: question.text, answer: '' }] };
			}
			continue;
		}
		const belongs = rounds.length === 1 ? question.belongs ?? section.belongs : section.belongs;
		sections[index] = { id: section.id, ...(belongs ? { belongs } : {}), rounds: [...rounds.slice(0, -1), { ...current, question: question.text }] };
	}
	return renderInventorAnswers(matter, sections);
}

/** The Working Record value of one applied answer: `IQ-2, answer 1, from inventor-answers.md`. */
export function appliedAnswerLabel(id: string, round: number): string {
	return `${id}, answer ${round}, from ${answersFile}`;
}

/** The 1-based number of the last answered round of a section, or `undefined` when none is answered. */
export function lastAnsweredRound(section: InventorAnswerSection | undefined): number | undefined {
	const rounds = section?.rounds ?? [];
	for (let index = rounds.length - 1; index >= 0; index--) {
		if (isAnswered(rounds[index].answer)) {
			return index + 1;
		}
	}
	return undefined;
}
