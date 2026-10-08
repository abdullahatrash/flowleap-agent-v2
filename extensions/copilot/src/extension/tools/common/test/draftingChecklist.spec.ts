/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { checklistPointer, DraftingChecklistFiles, readDraftingChecklist, renderChecklist } from '../drafting/checklist';
import { DraftFinding } from '../drafting/finding';
import { renderFindingsFile } from '../drafting/findingsFile';
import { updateInventorAnswers } from '../drafting/inventorAnswers';
import { parseInventorQuestions } from '../drafting/sourceMarkers';

const featureList = (confirmed = 'true') => `---\noffice: EPO\nconfirmed: ${confirmed}\n---\n| F1 | A lever. |\n`;
const claims = (approved = 'true') => `---\napproved: ${approved}\n---\n1. A hinge.\n`;
const draft = `---\noffice: EPO\n---\n# Hinge\n\n<!-- src: feature:F1 -->\nA lever.\n\n## Inventor Questions\n\n> **Inventor Question IQ-1:** Which steel grade?\n\n> **Inventor Question IQ-2:** How thick?\n`;

const errors: DraftFinding[] = [
	{ severity: 'Error', rule: 'source-marker', file: 'draft-application.md', line: 3, message: 'The paragraph at line 3 has no source marker (<!-- src: ... -->).' },
	{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 7, message: 'Line 7 writes "control-unit"; the defined term is "control unit".' },
	{ severity: 'Error', rule: 'inventor-question', file: 'draft-application.md', line: 11, message: 'Inventor Question IQ-1 is open: Which steel grade?' },
];

const answers = (fill: Record<string, string> = {}) => {
	let text = updateInventorAnswers(undefined, 'hinge', parseInventorQuestions(draft), new Set());
	for (const [id, answer] of Object.entries(fill)) {
		text = text.replace(new RegExp(`(## ${id}\\n[\\s\\S]*?\\*\\*Answer:\\*\\*\\n)`), `$1${answer}\n`);
	}
	return text;
};

const render = (files: Partial<DraftingChecklistFiles>) => renderChecklist(readDraftingChecklist({ matter: 'hinge', findingsCurrent: false, exported: false, ...files }));

describe('Application Drafting checklist', () => {

	it('nothing started: step 1 is next and the later steps wait', () => {
		expect(render({})).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names.

			- [ ] 1. Confirm the Feature List: feature-list.md does not exist
			      → Tell the agent: "Build the Feature List from the disclosure"
			- [ ] 2. Approve the claims: blocked by step 1
			- [ ] 3. Write the draft: blocked by steps 1 and 2
			- [ ] 4. Answer the Inventor Questions: blocked by step 3
			- [ ] 5. Fix or waive the Errors: blocked by step 3
			- [ ] 6. Export to Word: blocked by steps 1, 2, 3, 4 and 5

			Next step for you: step 1.
			"
		`);
	});

	it('gates open: names the file, the line and the text to write', () => {
		expect(render({ featureList: featureList('false'), claims: claims().replace('approved: true\n', '') })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names.

			- [ ] 1. Confirm the Feature List: feature-list.md has no \`confirmed: true\`
			      → Review feature-list.md, then on line 3 write:   confirmed: true
			- [ ] 2. Approve the claims: claims.md has no \`approved\` flag
			      → Review claims.md, then add to its frontmatter (between the \`---\` lines at the top):   approved: true
			- [ ] 3. Write the draft: blocked by steps 1 and 2
			- [ ] 4. Answer the Inventor Questions: blocked by step 3
			- [ ] 5. Fix or waive the Errors: blocked by step 3
			- [ ] 6. Export to Word: blocked by steps 1, 2, 3, 4 and 5

			Next step for you: step 1.
			"
		`);
	});

	it('Inventor Questions open and Errors open, with the answer slot lines and findings.md lines', () => {
		expect(render({ featureList: featureList(), claims: claims(), draft, inventorAnswers: answers(), findings: renderFindingsFile(errors), findingsCurrent: true })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names.

			- [x] 1. Feature List confirmed: feature-list.md has \`confirmed: true\`
			- [x] 2. Claims approved: claims.md has \`approved: true\`
			- [x] 3. Draft written: draft-application.md
			- [ ] 4. Answer the Inventor Questions: 2 open
			      → Fill each **Answer:** in inventor-answers.md (lines 11, 19), or send the file to the inventor
			      → Then tell the agent: "Apply the answers"
			- [ ] 5. Fix or waive the Errors: 2 open (findings.md lines 7, 8)
			      → To waive, add under the item:   - Waived: <your reason>
			      → To fix, tell the agent: "Fix the Errors in findings.md"
			- [ ] 6. Export to Word: blocked by steps 4 and 5

			Next step for you: step 4.
			"
		`);
	});

	it('answered but not applied, findings.md older than the draft', () => {
		expect(render({ featureList: featureList(), claims: claims(), draft, inventorAnswers: answers({ 'IQ-1': 'Grade 304.', 'IQ-2': 'Not stated' }), findings: renderFindingsFile(errors) })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names.

			- [x] 1. Feature List confirmed: feature-list.md has \`confirmed: true\`
			- [x] 2. Claims approved: claims.md has \`approved: true\`
			- [x] 3. Draft written: draft-application.md
			- [ ] 4. Answer the Inventor Questions: 1 open, 1 answered but not yet in the draft (IQ-1)
			      → Fill each **Answer:** in inventor-answers.md (line 20), or send the file to the inventor
			      → Then tell the agent: "Apply the answers"
			- [ ] 5. Fix or waive the Errors: findings.md is older than the draft
			      → Tell the agent: "Validate the draft"
			- [ ] 6. Export to Word: blocked by steps 4 and 5

			Next step for you: step 4.
			"
		`);
	});

	it('Errors waived and Inventor Questions applied: export is next', () => {
		const waived = errors.map(finding => ({ ...finding, waived: { reason: 'Accepted by the attorney.' } }));
		const applied = draft.replace(/\n## Inventor Questions[\s\S]*$/, '\n');
		expect(render({ featureList: featureList(), claims: claims(), draft: applied, inventorAnswers: answers({ 'IQ-1': 'Grade 304.' }), findings: renderFindingsFile(waived), findingsCurrent: true })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names.

			- [x] 1. Feature List confirmed: feature-list.md has \`confirmed: true\`
			- [x] 2. Claims approved: claims.md has \`approved: true\`
			- [x] 3. Draft written: draft-application.md
			- [x] 4. Inventor Questions answered and applied: none open in draft-application.md
			- [x] 5. Errors fixed or waived: none open in findings.md
			- [ ] 6. Export to Word: ready
			      → Tell the agent: "Export to Word"

			Next step for you: step 6.
			"
		`);
	});

	it('exported: every step is done', () => {
		const applied = draft.replace(/\n## Inventor Questions[\s\S]*$/, '\n');
		expect(render({ featureList: featureList(), claims: claims(), draft: applied, findings: renderFindingsFile([]), findingsCurrent: true, exported: true })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names.

			- [x] 1. Feature List confirmed: feature-list.md has \`confirmed: true\`
			- [x] 2. Claims approved: claims.md has \`approved: true\`
			- [x] 3. Draft written: draft-application.md
			- [x] 4. Inventor Questions answered and applied: none open in draft-application.md
			- [x] 5. Errors fixed or waived: none open in findings.md
			- [x] 6. Exported to Word: draft-application.description.docx, draft-application.claims.docx, draft-application.abstract.docx

			Next step for you: none. Review the Word files: they are a draft for attorney review, not a filing.
			"
		`);
	});

	it('a refusal points to the open checklist steps', () => {
		const checklist = readDraftingChecklist({ matter: 'hinge', featureList: featureList(), claims: claims(), draft, inventorAnswers: answers(), findings: renderFindingsFile(errors), findingsCurrent: true, exported: false });
		expect(checklistPointer(checklist, 'drafting/hinge/checklist.md')).toBe('Open in drafting/hinge/checklist.md: step 4 (Answer the Inventor Questions), step 5 (Fix or waive the Errors).');
	});

	it('an optional style step shows the exemplar count and the instruction; it never blocks', () => {
		const lines = (count: number) => render({ styleExemplars: count }).split('\n').filter(line => /Style exemplars|Put 1 to 5|^Next step/.test(line));
		expect({ none: lines(0), many: lines(7) }).toEqual({
			none: [
				'- Optional. Style exemplars: 0 files in style/',
				'      → Put 1 to 5 of your own filed applications or claim sets in style/ (.md, .docx, .pdf). FlowLeap copies their voice and structure only, never their facts. Leave the folder empty to use the office template style.',
				'Next step for you: step 1.',
			],
			many: [
				'- Optional. Style exemplars: 7 files in style/ (only the first 5 are read)',
				'      → Put 1 to 5 of your own filed applications or claim sets in style/ (.md, .docx, .pdf). FlowLeap copies their voice and structure only, never their facts. Leave the folder empty to use the office template style.',
				'Next step for you: step 1.',
			],
		});
	});
});
