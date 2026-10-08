/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseDraftParagraphs, parseInventorQuestions, stripSourceMarkers } from '../drafting/sourceMarkers';

const draft = [
	'---',
	'office: US',
	'---',
	'# Detailed Description',
	'',
	'<!-- src: feature:F3, disclosure:§2.1 -->',
	'The housing 12 holds the lever 14.',
	'',
	'<!-- src: model-proposed --> In general terms, the following applies.',
	'',
	'<!-- src: instruction -->',
	'The lever is made of steel.',
	'',
	'A paragraph without a source.',
	'',
	'<!-- src: guess -->',
	'A paragraph with an unknown source.',
	'',
	'## Inventor Questions',
	'',
	'> **Inventor Question IQ-1:** What material is the spring made of?',
	'> It is not stated in the disclosure.',
	'',
	'> **Inventor Question IQ-2:** Is the hinge removable?',
	'',
].join('\n');

describe('Application Drafting source markers', () => {

	it('parses paragraphs with their sources, section and the file line of their text', () => {
		expect(parseDraftParagraphs(draft)).toEqual([
			{ line: 4, kind: 'heading', section: 'Detailed Description', text: '# Detailed Description' },
			{ line: 7, kind: 'text', section: 'Detailed Description', text: 'The housing 12 holds the lever 14.', sources: [{ kind: 'feature', ref: 'F3' }, { kind: 'disclosure', ref: '§2.1' }] },
			{ line: 9, kind: 'text', section: 'Detailed Description', text: 'In general terms, the following applies.', sources: [{ kind: 'model-proposed' }] },
			{ line: 12, kind: 'text', section: 'Detailed Description', text: 'The lever is made of steel.', sources: [{ kind: 'instruction' }] },
			{ line: 14, kind: 'text', section: 'Detailed Description', text: 'A paragraph without a source.' },
			{ line: 17, kind: 'text', section: 'Detailed Description', text: 'A paragraph with an unknown source.', markerError: 'Unknown source "guess". Use feature:<row>, disclosure:<span>, instruction, template or model-proposed.' },
			{ line: 19, kind: 'heading', section: 'Inventor Questions', text: '## Inventor Questions' },
			{ line: 21, kind: 'inventor-question', section: 'Inventor Questions', text: '> **Inventor Question IQ-1:** What material is the spring made of?\n> It is not stated in the disclosure.' },
			{ line: 24, kind: 'inventor-question', section: 'Inventor Questions', text: '> **Inventor Question IQ-2:** Is the hinge removable?' },
		]);
	});

	it('parses Inventor Question blocks', () => {
		expect(parseInventorQuestions(draft)).toEqual([
			{ id: 'IQ-1', line: 21, text: 'What material is the spring made of? It is not stated in the disclosure.' },
			{ id: 'IQ-2', line: 24, text: 'Is the hinge removable?' },
		]);
	});

	it('strips source markers for export and keeps the text', () => {
		expect(stripSourceMarkers('# A\n\n<!-- src: template -->\nFirst.\n\n<!-- src: feature:F1 --> Second.\n')).toBe('# A\n\nFirst.\n\nSecond.\n');
	});
});
