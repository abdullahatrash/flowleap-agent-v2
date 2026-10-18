/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import * as mammoth from 'mammoth';
import { OpenInventorQuestion } from '../common/drafting/inventorAnswers';

const questionId = /^IQ-\d+$/;

/** The columns of the table, in order; the answer is the last one. */
const columns = [{ title: 'No.', width: 10 }, { title: 'Question', width: 40 }, { title: 'Where the answer goes', width: 20 }, { title: 'Your answer', width: 30 }];

function cell(text: string, width: number, bold = false): TableCell {
	return new TableCell({
		width: { size: width, type: WidthType.PERCENTAGE },
		children: [new Paragraph({ children: [new TextRun(bold ? { text, bold } : text)] })],
	});
}

/**
 * Builds `inventor-questions.docx`: a heading, a short paragraph that tells the inventor what to
 * do, and one table with a row per open Inventor Question (its id, the question, where the answer
 * goes in the application, and an empty answer cell). {@link readInventorQuestionsDocx} reads
 * the answered file back.
 */
export async function buildInventorQuestionsDocx(matter: string, questions: readonly OpenInventorQuestion[]): Promise<Uint8Array> {
	const header = new TableRow({ tableHeader: true, children: columns.map(column => cell(column.title, column.width, true)) });
	const rows = questions.map(question => new TableRow({
		children: [question.id, question.question, question.belongs ?? '', ''].map((text, index) => cell(text, columns[index].width)),
	}));
	const document = new Document({
		sections: [{
			children: [
				new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Questions for the inventor: ${matter}`)] }),
				new Paragraph({ children: [new TextRun('Your patent attorney needs these facts for the patent application. Write your answer in the "Your answer" column of each row. Leave the cell empty when you do not know. Do not change the other columns. Save the file and send it back to your patent attorney.')] }),
				new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }),
			],
		}],
	});
	return new Uint8Array(await Packer.toBuffer(document));
}

const entities: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&amp;': '&' };

/** The text of one table cell of mammoth's HTML: one line per paragraph or line break. */
function cellText(html: string): string {
	return html
		.replace(/<br\s*\/?>|<\/p>/g, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&(?:lt|gt|quot|#39|amp);/g, entity => entities[entity])
		.split('\n').map(line => line.trim()).join('\n').trim();
}

/**
 * Reads the answers of an answered `inventor-questions.docx`: question id to the text of the last
 * cell of its row (empty when the inventor wrote nothing). Rows whose first cell is not an id
 * (`IQ-<n>`), the header row included, are not answers.
 */
export async function readInventorQuestionsDocx(bytes: Uint8Array): Promise<Map<string, string>> {
	const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
	const answers = new Map<string, string>();
	for (const row of html.matchAll(/<tr>(?<cells>[\s\S]*?)<\/tr>/g)) {
		const cells = [...(row.groups?.cells ?? '').matchAll(/<t[dh]\b[^>]*>(?<content>[\s\S]*?)<\/t[dh]>/g)].map(match => cellText(match.groups?.content ?? ''));
		if (cells.length > 1 && questionId.test(cells[0])) {
			answers.set(cells[0], cells.at(-1) ?? '');
		}
	}
	return answers;
}
