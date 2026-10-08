/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DraftFinding } from '../drafting/finding';
import { blockingFindings, mergeFindings, parseFindingsFile, renderFindingsFile } from '../drafting/findingsFile';

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

	it('lists unwaived Errors as blocking, never Notes or Advisory items', () => {
		expect(blockingFindings(findings)).toEqual([findings[1], findings[2]]);
	});
});
