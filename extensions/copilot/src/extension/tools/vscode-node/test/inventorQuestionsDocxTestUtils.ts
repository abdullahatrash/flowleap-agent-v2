/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import JSZip from 'jszip';

/** Writes answers into the answer cells of an `inventor-questions.docx`, the way the inventor does in Word. */
export async function answerInWord(bytes: Uint8Array, answers: Record<string, string>): Promise<Uint8Array> {
	const zip = await JSZip.loadAsync(bytes);
	const xml = await zip.file('word/document.xml')!.async('string');
	const emptyCell = '<w:t xml:space="preserve"></w:t>';
	const rows = xml.split('<w:tr>').map(row => {
		const id = /<w:t xml:space="preserve">(?<id>IQ-\d+)<\/w:t>/.exec(row)?.groups?.id;
		const answer = id ? answers[id] : undefined;
		const at = row.lastIndexOf(emptyCell);
		return answer === undefined ? row : `${row.slice(0, at)}<w:t xml:space="preserve">${answer}</w:t>${row.slice(at + emptyCell.length)}`;
	});
	zip.file('word/document.xml', rows.join('<w:tr>'));
	return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}
