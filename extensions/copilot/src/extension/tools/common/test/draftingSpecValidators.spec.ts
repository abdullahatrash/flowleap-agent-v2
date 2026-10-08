/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseInventorAnswers } from '../drafting/inventorAnswers';
import { parseDraftParagraphs } from '../drafting/sourceMarkers';
import { checkAbstractLength, checkDefinedTerms, checkEpoAbstractFigure, checkInventorQuestions, checkReferenceNumerals, checkSourceMarkers, figureHeadingCount, hasFigures, parseFigureParts, parseFigureSections, readReferenceSigns } from '../drafting/specValidators';

function draft(...lines: string[]) {
	return parseDraftParagraphs(lines.join('\n'));
}

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');

const figures = [
	'# Figures',
	'',
	'## FIG. 1: perspective view of the hinge',
	'- 10: hinge',
	'- 12: housing',
	'| 14 | coil spring |',
].join('\n');

describe('Application Drafting specification validators', () => {

	it('abstract length: pass at 150 words', () => {
		const text = draft('# Abstract', '', `<!-- src: template --> ${words(150)}`);
		expect([checkAbstractLength(text, 'US'), checkAbstractLength(text, 'EPO')]).toEqual([[], []]);
	});

	it('abstract length: Error over 150 words for US, Note for EPO; Error when the Abstract is missing', () => {
		const long = draft('# Abstract of the Disclosure', '', '<!-- src: template -->', words(100), '', `<!-- src: feature:F1 --> ${words(51)}`);
		expect([
			checkAbstractLength(long, 'US'),
			checkAbstractLength(long, 'EPO'),
			checkAbstractLength(draft('# Description', '', 'Text.'), 'EPO'),
		]).toEqual([
			[{ severity: 'Error', rule: 'abstract-length', file: 'draft-application.md', line: 1, message: 'The Abstract has 151 words; it must have at most 150 (37 CFR 1.72(b)).' }],
			[{ severity: 'Note', rule: 'abstract-length', file: 'draft-application.md', line: 1, message: 'The Abstract has 151 words; Rule 47(3) EPC asks for preferably at most 150.' }],
			[{ severity: 'Error', rule: 'abstract-length', file: 'draft-application.md', message: 'The draft has no Abstract section (a heading that contains "Abstract").' }],
		]);
	});

	it('EPO abstract figure: pass when the Abstract names a figure and puts reference signs in parentheses, and without figures', () => {
		expect([
			checkEpoAbstractFigure(draft('# Abstract', '', '<!-- src: template -->', 'A hinge (10) has a housing (12) and a coil spring (14). (Fig. 1)'), figures),
			checkEpoAbstractFigure(draft('# Abstract', '', '<!-- src: template -->', 'A hinge has a housing.'), ''),
		]).toEqual([[], []]);
	});

	it('EPO abstract figure: Note when the Abstract names no figure or has features without signs in parentheses (Rule 47(4) EPC)', () => {
		expect(checkEpoAbstractFigure(draft('# Abstract', '', '<!-- src: template -->', 'A hinge (10) has a housing 12 and a coil spring.'), figures)).toEqual([
			{ severity: 'Note', rule: 'epo-abstract-figure', file: 'draft-application.md', line: 1, message: 'The Abstract names no figure to publish with it. Rule 47(4) EPC: name the figure, e.g. "(Fig. 1)".' },
			{ severity: 'Note', rule: 'epo-abstract-figure', file: 'draft-application.md', line: 1, message: 'The Abstract mentions "housing", "coil spring" without their reference signs in parentheses. Rule 47(4) EPC: follow each main feature shown in a figure by its reference sign in parentheses, e.g. "housing (12)".' },
		]);
	});

	it('defined terms: pass when a defined term keeps its spelling', () => {
		expect(checkDefinedTerms(draft('A control unit (hereinafter "control unit") is used.', '', 'The control unit is small.'))).toEqual([]);
	});

	it('defined terms: Error for another spelling of a defined term', () => {
		expect(checkDefinedTerms(draft('A unit is referred to as "control unit".', '', 'The control-unit is small.', '', '"Sensor module" means the part.', '', 'The sensormodule and the Sensor module work.'))).toEqual([
			{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 3, message: 'Line 3 writes "control-unit"; the defined term is "control unit".' },
			{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 7, message: 'Line 7 writes "sensormodule"; the defined term is "Sensor module".' },
		]);
	});

	it('defined terms: one-word terms and case variants of a capitalised term', () => {
		expect([
			checkDefinedTerms(draft('A unit (hereinafter "Controller") is used.', '', 'The Controller is small. A controller-board holds the Controller.')),
			checkDefinedTerms(draft('A unit (hereinafter "Controller") is used.', '', 'The controller is small.', '', '"Sensor Module" means the part.', '', 'The sensor module and the Sensor-Module work.')),
			checkDefinedTerms(draft('"bolt" means the pin.', '', 'Bolt 12 holds. The bolt holds.')),
		]).toEqual([
			[],
			[
				{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 3, message: 'Line 3 writes "controller"; the defined term is "Controller".' },
				{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 7, message: 'Line 7 writes "sensor module"; the defined term is "Sensor Module".' },
				{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 7, message: 'Line 7 writes "Sensor-Module"; the defined term is "Sensor Module".' },
			],
			[],
		]);
	});

	it('figure parts: parses list items and table rows with their lines', () => {
		expect(parseFigureParts(figures)).toEqual([
			{ numeral: '10', part: 'hinge', line: 4 },
			{ numeral: '12', part: 'housing', line: 5 },
			{ numeral: '14', part: 'coil spring', line: 6 },
		]);
	});

	it('reference numerals: pass when text and figures.md agree', () => {
		expect(checkReferenceNumerals(draft(
			'# Brief Description of the Drawings',
			'',
			'FIG. 1 shows the hinge 10 of about 5 mm, set at 90 degrees, as in claim 1 and in 2024.',
			'',
			'The housing 12 holds the spring 14 (see FIGS. 1 and 2).',
		), figures)).toEqual([]);
	});

	it('reference numerals: Error for unknown, unused, mismatched and doubled numerals', () => {
		const doubled = `${figures}\n- 12: lever\n- 16: housing`;
		expect(checkReferenceNumerals(draft(
			'The hinge 10 has a lever 12 and a damper 18.',
		), doubled)).toEqual([
			{ severity: 'Error', rule: 'reference-numeral', file: 'figures.md', line: 7, message: 'Numeral 12 names two parts in figures.md: "housing" and "lever". Use one numeral per part.' },
			{ severity: 'Error', rule: 'reference-numeral', file: 'figures.md', line: 8, message: 'Part "housing" has two numerals in figures.md: 12 and 16. Use one numeral per part.' },
			{ severity: 'Error', rule: 'reference-numeral', file: 'draft-application.md', line: 1, message: 'Line 1 uses numeral 18 ("damper 18"), which figures.md does not list.' },
			{ severity: 'Error', rule: 'reference-numeral', file: 'figures.md', line: 6, message: 'Numeral 14 ("coil spring") in figures.md does not appear in the draft text.' },
			{ severity: 'Error', rule: 'reference-numeral', file: 'figures.md', line: 8, message: 'Numeral 16 ("housing") in figures.md does not appear in the draft text.' },
		]);
	});

	it('reference numerals: Error when the text names a numeral as another part', () => {
		expect(checkReferenceNumerals(draft('The hinge 10 has a housing 12 and a lever 14.'), figures)).toEqual([
			{ severity: 'Error', rule: 'reference-numeral', file: 'draft-application.md', line: 1, message: 'Line 1 writes "lever 14", but figures.md names numeral 14 "coil spring".' },
		]);
	});

	it('source markers: pass when every text paragraph outside the claims has a source', () => {
		expect(checkSourceMarkers(draft('# Description', '', '<!-- src: feature:F1 -->', 'Text.', '', '# Claims', '', '1. A hinge.'))).toEqual([]);
	});

	it('source markers: Error for a paragraph without a source or with an invalid marker', () => {
		expect(checkSourceMarkers(draft('# Description', '', 'No source.', '', '<!-- src: feature -->', 'Bad marker.'))).toEqual([
			{ severity: 'Error', rule: 'source-marker', file: 'draft-application.md', line: 3, message: 'The paragraph at line 3 has no source marker (<!-- src: ... -->).' },
			{ severity: 'Error', rule: 'source-marker', file: 'draft-application.md', line: 6, message: 'The paragraph at line 6 has an invalid source marker: Unknown source "feature". Use feature:<row>, disclosure:<span>, inventor:IQ-<n>, instruction, template or model-proposed.' },
		]);
	});

	it('inventor questions: pass when none is open', () => {
		expect(checkInventorQuestions('# Description\n\n<!-- src: template -->\nText.')).toEqual([]);
	});

	it('inventor questions: Error for each open Inventor Question', () => {
		expect(checkInventorQuestions('## Inventor Questions\n\n> **Inventor Question IQ-1:** What is the spring made of?')).toEqual([
			{ severity: 'Error', rule: 'inventor-question', file: 'draft-application.md', line: 3, question: 'IQ-1', message: 'Inventor Question IQ-1 is open: What is the spring made of?' },
		]);
	});

	it('inventor answers: the marker needs a filled answer, and an answered question still in the draft says to apply it', () => {
		const answers = parseInventorAnswers([
			'## IQ-1', '', '**Question:** What is the spring made of?', '', '**Answer:**', 'Spring steel.',
			'', '## IQ-2', '', '**Question:** Is the hinge removable?', '', '**Answer:** Not stated.',
		].join('\n'));
		const text = [
			'# Description', '',
			'<!-- src: inventor:IQ-1 -->', 'The spring is spring steel.', '',
			'<!-- src: inventor:IQ-2 -->', 'The hinge is removable.', '',
			'## Inventor Questions', '',
			'> **Inventor Question IQ-1:** What is the spring made of?', '',
			'> **Inventor Question IQ-2:** Is the hinge removable?',
		].join('\n');
		expect({ markers: checkSourceMarkers(parseDraftParagraphs(text), answers), questions: checkInventorQuestions(text, answers).map(finding => finding.message) }).toEqual({
			markers: [
				{ severity: 'Error', rule: 'source-marker', file: 'draft-application.md', line: 7, message: 'The paragraph at line 7 cites inventor:IQ-2, but inventor-answers.md has no answer to IQ-2.' },
			],
			questions: [
				'Inventor Question IQ-1 is answered in inventor-answers.md; apply it to the draft: What is the spring made of?',
				'Inventor Question IQ-2 is open: Is the hinge removable?',
			],
		});
	});

	it('figure headings: a range or list counts each figure; a heading without a figure name is no figure', () => {
		const figures = '# Figures\n\n- 8: base\n\n## FIG. 1\n\n- 10: frame\n\n## FIGS. 7 to 10\n\n- 14: cam\n\n## Parts named in the answers, figure not stated\n\n- 16: spring\n';
		expect({
			counts: ['FIG. 1', 'FIGS. 7 to 10', 'Figs. 7-10', 'FIGS. 7 and 8', 'FIGS. 1, 3 and 5', 'Figure 2: side view', 'Figures', 'Parts named in the answers, figure not stated', 'a figure 8 track'].map(figureHeadingCount),
			sections: parseFigureSections(figures).figures.map(section => [section.label, section.count, section.parts.map(part => part.numeral)]),
			drawn: parseFigureSections(figures).drawnParts.map(part => part.numeral),
			hasFigures: [hasFigures(figures), hasFigures('# Figures\n'), hasFigures('- 12: housing\n')],
		}).toEqual({
			counts: [1, 4, 4, 2, 3, 1, 0, 0, 0],
			sections: [['FIG. 1', 1, ['10']], ['FIGS. 7 to 10', 4, ['14']]],
			drawn: ['10', '14'],
			hasFigures: [true, false, true],
		});
	});

	it('EPO abstract figure: not fooled by headings that name no figure, nor by parts under them', () => {
		const abstract = draft('# Title', '', '## Abstract', '', '<!-- src: feature:F1 -->', 'A frame (10) holds a spring.');
		expect([
			checkEpoAbstractFigure(abstract, '# Figures\n\n## Parts named in the answers, figure not stated\n\n- 16: spring\n'),
			checkEpoAbstractFigure(abstract, '# Figures\n\n## FIG. 1\n\n- 10: frame\n\n## Parts named in the answers, figure not stated\n\n- 16: spring\n').map(finding => finding.message),
		]).toEqual([
			[],
			['The Abstract names no figure to publish with it. Rule 47(4) EPC: name the figure, e.g. "(Fig. 1)".'],
		]);
	});

	it('inventor questions: a question removed from the draft while its narrowed question has no answer is an Error', () => {
		const answers = parseInventorAnswers([
			'## IQ-1', '', '**Question:** What is the spring made of?', '', '**Answer:**', 'Steel; the grade is not known.', '', '**Narrowed question:** What steel grade?', '', '**Answer:**',
			'', '## IQ-2', '', '**Question:** Is the hinge removable?', '', '**Answer:** Yes.',
		].join('\n'));
		expect(checkInventorQuestions('# Description\n\n<!-- src: inventor:IQ-1 -->\nThe spring is steel.', answers)).toEqual([
			{ severity: 'Error', rule: 'inventor-question', file: 'inventor-answers.md', line: 10, question: 'IQ-1', message: 'Inventor Question IQ-1 is no longer in the draft, but its narrowed question has no answer in inventor-answers.md. Put the question back in the draft, or waive it. Question: What steel grade?' },
		]);
	});

	it('reference numerals: a number after a word such as grade, type or model is no reference sign', () => {
		expect(readReferenceSigns('The lever 14 is grade 304 steel of type 2, model 7, series 300, class 8, size 10, sample 3 and the housing (12).').map(sign => `${sign.word} ${sign.numeral}`)).toEqual(['lever 14', 'housing 12']);
	});
});
