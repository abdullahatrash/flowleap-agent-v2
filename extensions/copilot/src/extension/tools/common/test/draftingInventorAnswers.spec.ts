/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isAnswered, newlyAppliedAnswers, parseInventorAnswers, updateInventorAnswers } from '../drafting/inventorAnswers';
import { InventorQuestion } from '../drafting/sourceMarkers';

const questions: InventorQuestion[] = [
	{ id: 'IQ-1', line: 40, text: 'Which steel grade is the lever made of, and how thick is it?', belongs: 'Detailed Description, after the paragraph on the lever 14.' },
	{ id: 'IQ-2', line: 42, text: 'Is the hinge removable?' },
];

describe('Application Drafting inventor answers file', () => {

	it('writes one section per question with an empty answer slot', () => {
		expect(updateInventorAnswers(undefined, 'hinge', questions, new Set())).toMatchInlineSnapshot(`
			"# Inventor answers: hinge

			Write the inventor's answer under each **Answer:**. Leave it empty, or write "Not stated", when the inventor does not know. Then tell the agent: "Apply the answers". The agent copies each answer into the draft; it never answers a question itself.

			## IQ-1

			**Question:** Which steel grade is the lever made of, and how thick is it?

			**Belongs:** Detailed Description, after the paragraph on the lever 14.

			**Answer:**

			## IQ-2

			**Question:** Is the hinge removable?

			**Belongs:** see the question

			**Answer:**
			"
		`);
	});

	it('round trip: a re-save adds new questions and keeps every filled answer', () => {
		const filled = updateInventorAnswers(undefined, 'hinge', questions.slice(0, 1), new Set())
			.replace('**Answer:**\n', '**Answer:**\nGrade 304.\nThe lever is 4 mm thick.\n');
		const resaved = updateInventorAnswers(filled, 'hinge', [{ ...questions[0], text: 'Reworded by the model?' }, ...questions.slice(1)], new Set());
		expect(parseInventorAnswers(resaved)).toEqual([
			{ id: 'IQ-1', belongs: 'Detailed Description, after the paragraph on the lever 14.', rounds: [{ question: 'Which steel grade is the lever made of, and how thick is it?', answer: 'Grade 304.\nThe lever is 4 mm thick.', answerLine: 11 }] },
			{ id: 'IQ-2', belongs: 'see the question', rounds: [{ question: 'Is the hinge removable?', answer: '', answerLine: 21 }] },
		]);
	});

	it('a partial answer narrows the question: an applied answer of a question still in the draft gets a new empty slot', () => {
		const filled = updateInventorAnswers(undefined, 'hinge', questions.slice(0, 1), new Set())
			.replace('**Answer:**\n', '**Answer:**\nGrade 304. The thickness is not known.\n');
		const narrowed = updateInventorAnswers(filled, 'hinge', [{ ...questions[0], text: 'How thick is the lever?' }], new Set(['IQ-1']));
		expect(parseInventorAnswers(narrowed)).toEqual([
			{
				id: 'IQ-1', belongs: 'Detailed Description, after the paragraph on the lever 14.', rounds: [
					{ question: 'Which steel grade is the lever made of, and how thick is it?', answer: 'Grade 304. The thickness is not known.', answerLine: 11 },
					{ question: 'How thick is the lever?', answer: '', answerLine: 16 },
				],
			},
		]);
	});

	it('an empty answer, "Not stated" or "unknown" is no answer', () => {
		expect(['', '  ', 'Not stated', 'Not stated.', 'unknown', '**Unknown**', 'Grade 304.'].map(isAnswered)).toEqual([false, false, false, false, false, false, true]);
	});

	it('never loses text: an answer with a heading line and the attorney\'s notes survives a save unchanged', () => {
		const filled = updateInventorAnswers(undefined, 'hinge', questions, new Set())
			.replace('Write the inventor', 'Sent to the inventor on 2026-10-08.\n\nWrite the inventor')
			.replace('**Answer:**\n\n## IQ-2', '**Answer:** Stainless steel.\n# Thickness\n4 mm, from the inventor\'s sketch.\n\nNote (attorney): check the sketch.\n\n## IQ-2');
		const resaved = updateInventorAnswers(filled, 'hinge', questions, new Set());
		expect({ unchanged: resaved === filled, answer: parseInventorAnswers(resaved)[0].rounds[0].answer }).toEqual({
			unchanged: true,
			answer: 'Stainless steel.\n# Thickness\n4 mm, from the inventor\'s sketch.\n\nNote (attorney): check the sketch.',
		});
	});

	it('a filled answer not yet applied stays current: no new round until a save applies it', () => {
		const filled = updateInventorAnswers(undefined, 'hinge', questions.slice(0, 1), new Set())
			.replace('**Answer:**\n', '**Answer:**\nStainless steel.\n');
		const narrowed = updateInventorAnswers(filled, 'hinge', [{ ...questions[0], text: 'How thick is the lever?' }], new Set(['IQ-1']));
		const secondFilled = narrowed.replace(/\*\*Answer:\*\*\n$/, '**Answer:**\n4 mm.\n');
		expect({
			notApplied: updateInventorAnswers(secondFilled, 'hinge', [{ ...questions[0], text: 'How thick is the lever?' }], new Set()) === secondFilled,
			rounds: parseInventorAnswers(secondFilled)[0].rounds.map(round => round.answer),
		}).toEqual({ notApplied: true, rounds: ['Stainless steel.', '4 mm.'] });
	});

	it('an answer is applied by a save when the draft text that cites it is new or changed', () => {
		const cite = (text: string) => `# Hinge\n\n<!-- src: inventor:IQ-1 -->\n${text}\n\n<!-- src: inventor:IQ-2 -->\nThe hinge is removable.\n`;
		expect({
			first: [...newlyAppliedAnswers(undefined, cite('The lever is steel.'))],
			unchanged: [...newlyAppliedAnswers(cite('The lever is steel.'), cite('The lever is steel.'))],
			changed: [...newlyAppliedAnswers(cite('The lever is steel.'), cite('The lever is steel, 4 mm thick.'))],
		}).toEqual({ first: ['IQ-1', 'IQ-2'], unchanged: [], changed: ['IQ-1'] });
	});
});
