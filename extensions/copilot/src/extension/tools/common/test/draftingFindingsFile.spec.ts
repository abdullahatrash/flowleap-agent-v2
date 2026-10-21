/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DraftFinding } from '../drafting/finding';
import { blockingFindings, findingsWaiverInsertions, mergeFindings, parseFindingsFile, parseFindingsFileItems, renderFindingsFile } from '../drafting/findingsFile';

const findings: DraftFinding[] = [
	{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3: "the spring" has no antecedent basis.', waived: { reason: 'Spring is inherent in the hinge type.' } },
	{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 12, message: 'Line 12 writes "control-unit"; the defined term is "control unit".' },
	{ severity: 'Error', rule: 'inventor-question', file: 'draft-application.md', line: 40, message: 'Inventor Question IQ-1 is open: What is the spring made of?' },
	{ severity: 'Note', rule: 'claim-count', file: 'claims.md', message: '21 claims in total.' },
	{ severity: 'Advisory', rule: 'advisory', message: 'Paragraph [0012] ("the lever pivots") may read on an embodiment not in the disclosure.\nCheck it.' },
];

describe('Application Drafting findings file', () => {

	it('renders findings by section, with waivers under their item', () => {
		expect(renderFindingsFile(findings)).toMatchInlineSnapshot(`
			"# Findings

			Errors and Inventor Questions block export until they are resolved or waived. To waive one, add a line \`  - Waived: <reason>\` under it. Notes never block. Advisory items come from the model review; they are advice, not a pass.

			## Errors

			- \`antecedent-basis\` (claims.md, line 3, claim 3): Claim 3: "the spring" has no antecedent basis.
			  - Waived: Spring is inherent in the hinge type.
			- \`defined-term\` (draft-application.md, line 12): Line 12 writes "control-unit"; the defined term is "control unit".

			## Inventor Questions

			- \`inventor-question\` (draft-application.md, line 40): Inventor Question IQ-1 is open: What is the spring made of?

			## Notes

			- \`claim-count\` (claims.md): 21 claims in total.

			## Advisory

			- \`advisory\`: Paragraph [0012] ("the lever pivots") may read on an embodiment not in the disclosure. Check it.
			"
		`);
	});

	it('parses a rendered file back to the same findings, with an attorney waiver added', () => {
		const edited = renderFindingsFile(findings).replace(
			'- `inventor-question` (draft-application.md, line 40): Inventor Question IQ-1 is open: What is the spring made of?',
			'- `inventor-question` (draft-application.md, line 40): Inventor Question IQ-1 is open: What is the spring made of?\n  - Waived: Inventor confirmed by phone: steel.\n  - Waived:   ',
		);
		expect(parseFindingsFile(edited)).toEqual([
			findings[0],
			findings[1],
			{ ...findings[2], waived: { reason: 'Inventor confirmed by phone: steel.' } },
			findings[3],
			{ ...findings[4], message: 'Paragraph [0012] ("the lever pivots") may read on an embodiment not in the disclosure. Check it.' },
		]);
	});

	it('merges: keeps waivers across moved lines, keeps earlier Advisory items when none are new, and lists blocking findings', () => {
		const previous = parseFindingsFile(renderFindingsFile(findings));
		const current: DraftFinding[] = [
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 4, claim: 3, message: 'Claim 3: "the spring" has no antecedent basis.' },
			{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 15, message: 'Line 15 writes "control-unit"; the defined term is "control unit".' },
		];
		const merged = mergeFindings(current, [...previous.slice(0, 1), { ...previous[1], waived: { reason: 'Client spelling.' } }, previous[4]]);
		expect({ merged, blocking: blockingFindings(merged) }).toEqual({
			merged: [
				{ ...current[0], waived: { reason: 'Spring is inherent in the hinge type.' } },
				{ ...current[1], waived: { reason: 'Client spelling.' } },
				previous[4],
			],
			blocking: [],
		});
	});

	it('keeps a waived Drawing Set Figure item across a validator run that has no drawing findings, but not an unwaived one', () => {
		const previous = parseFindingsFile([
			'# Findings', '', '## Errors', '',
			'- `numeral-not-allowed` (FIG-1.scene.json): Numeral 12 is not in the figures list.',
			'  - Waived: The top face is named in the description only.',
			'- `lead-lines-cross` (FIG-2.svg): The lead lines of numerals 4 and 6 cross.',
			'',
		].join('\n'));
		const current: DraftFinding[] = [{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 12, message: 'Line 12 writes "control-unit"; the defined term is "control unit".' }];
		expect(mergeFindings(current, previous)).toEqual([
			current[0],
			{ severity: 'Error', rule: 'numeral-not-allowed', file: 'FIG-1.scene.json', message: 'Numeral 12 is not in the figures list.', waived: { reason: 'The top face is named in the description only.' } },
		]);
	});

	it('round-trips the waivers a click writes: each Error waived, the waived item and the Inventor Question left alone', () => {
		const text = renderFindingsFile(findings);
		const lines = text.split('\n');
		const insertions = findingsWaiverInsertions(text, parseFindingsFileItems(text).map(item => item.fileLine), 'Reviewed by the attorney.');
		for (const { afterLine, text: waiver } of [...insertions].reverse()) {
			lines.splice(afterLine, 0, waiver);
		}
		const written = lines.join('\n');
		const waived = findings.map((finding, index) => index === 1 ? { ...finding, waived: { reason: 'Reviewed by the attorney.' } } : finding);
		expect({ insertions, written: written === renderFindingsFile(waived), blocking: blockingFindings(parseFindingsFile(written)) }).toEqual({
			insertions: [{ afterLine: 9, text: '  - Waived: Reviewed by the attorney.' }],
			written: true,
			blocking: [findings[2]],
		});
	});

	it('lists unwaived Errors as blocking, never Notes or Advisory items', () => {
		expect(blockingFindings(findings)).toEqual([findings[1], findings[2]]);
	});
});
