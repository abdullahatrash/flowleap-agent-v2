/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import { OpenInventorQuestion } from '../../common/drafting/inventorAnswers';
import { buildInventorQuestionsDocx, readInventorQuestionsDocx } from '../inventorQuestionsDocx';
import { answerInWord } from './inventorQuestionsDocxTestUtils';

const eightQuestions: OpenInventorQuestion[] = Array.from({ length: 8 }, (_, index) => ({
	id: `IQ-${index + 1}`,
	question: `Question ${index + 1} on the lever & the "housing"?`,
	...(index === 0 ? { belongs: 'Detailed Description, after the paragraph on the lever 14.' } : {}),
}));

describe('inventor-questions.docx', () => {
	it('round trip: eight open questions give eight rows with empty answer cells; three answers written in Word read back', async () => {
		const sent = await buildInventorQuestionsDocx('hinge', eightQuestions);
		const text = (await mammoth.extractRawText({ buffer: Buffer.from(sent) })).value.split('\n').filter(Boolean);
		const answered = await answerInWord(sent, { 'IQ-1': 'Grade 304 &amp; 4 mm.', 'IQ-3': 'Yes.', 'IQ-6': 'About 40 &lt; 50 N.' });
		expect({
			heading: text.slice(0, 2),
			rows: [...await readInventorQuestionsDocx(sent)],
			answers: [...await readInventorQuestionsDocx(answered)].filter(([, answer]) => answer),
		}).toEqual({
			heading: [
				'Questions for the inventor: hinge',
				'Your patent attorney needs these facts for the patent application. Write your answer in the "Your answer" column of each row. Leave the cell empty when you do not know. Do not change the other columns. Save the file and send it back to your patent attorney.',
			],
			rows: eightQuestions.map(question => [question.id, '']),
			answers: [['IQ-1', 'Grade 304 & 4 mm.'], ['IQ-3', 'Yes.'], ['IQ-6', 'About 40 < 50 N.']],
		});
	});
});
