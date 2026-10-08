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

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names. The step numbers are the steps of the application-drafting skill.

			- [ ] 1. Confirm the Feature List: feature-list.md does not exist
			      → Tell the agent: "Build the Feature List from the disclosure"
			- [ ] 2. Approve the claims: blocked by step 1
			- [ ] 3. Write the draft: blocked by steps 1 and 2
			- [ ] 4. Fix or waive the Errors: blocked by step 3
			- [ ] 5. Answer the Inventor Questions: blocked by step 3
			- [ ] 6. Export to Word: blocked by steps 1, 2, 3, 4 and 5

			Not blocking:

			- Figures: figures.md does not exist
			      → When the application has drawings, add one heading per figure to figures.md (e.g. "## FIG. 1") with its parts, or tell the agent: "Build figures.md from the disclosure"

			Next step for you: step 1.
			"
		`);
	});

	it('gates open: names the file, the line and the text to write', () => {
		expect(render({ featureList: featureList('false'), claims: claims().replace('approved: true\n', '') })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names. The step numbers are the steps of the application-drafting skill.

			- [ ] 1. Confirm the Feature List: feature-list.md has no \`confirmed: true\`
			      → Review feature-list.md, then on line 3 write:   confirmed: true
			- [ ] 2. Approve the claims: claims.md has no \`approved\` flag
			      → Review claims.md, then add to its frontmatter (between the \`---\` lines at the top):   approved: true
			- [ ] 3. Write the draft: blocked by steps 1 and 2
			- [ ] 4. Fix or waive the Errors: blocked by step 3
			- [ ] 5. Answer the Inventor Questions: blocked by step 3
			- [ ] 6. Export to Word: blocked by steps 1, 2, 3, 4 and 5

			Not blocking:

			- Figures: figures.md does not exist
			      → When the application has drawings, add one heading per figure to figures.md (e.g. "## FIG. 1") with its parts, or tell the agent: "Build figures.md from the disclosure"

			Next step for you: step 1.
			"
		`);
	});

	it('Inventor Questions open and Errors open, with the answer slot lines and findings.md lines', () => {
		expect(render({ featureList: featureList(), claims: claims(), draft, inventorAnswers: answers(), findings: renderFindingsFile(errors), findingsCurrent: true })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names. The step numbers are the steps of the application-drafting skill.

			- [x] 1. Feature List confirmed: feature-list.md has \`confirmed: true\`
			- [x] 2. Claims approved: claims.md has \`approved: true\`
			- [x] 3. Draft written: draft-application.md
			- [ ] 4. Fix or waive the Errors: 2 open (findings.md lines 7, 8)
			      → To waive, add under the item:   - Waived: <your reason>
			      → To fix, tell the agent: "Fix the Errors in findings.md"
			- [ ] 5. Answer the Inventor Questions: 2 open
			      → Fill each **Answer:** in inventor-answers.md (lines 11, 19), or send the file to the inventor
			      → Then tell the agent: "Apply the answers"
			- [ ] 6. Export to Word: blocked by steps 4 and 5

			Not blocking:

			- Figures: figures.md does not exist
			      → When the application has drawings, add one heading per figure to figures.md (e.g. "## FIG. 1") with its parts, or tell the agent: "Build figures.md from the disclosure"
			- Required sections: missing in draft-application.md: Technical Field, Background Art, Summary of the Invention, Description of Embodiments, Claims, Abstract
			      → Tell the agent: "Add the missing sections: Technical Field, Background Art, Summary of the Invention, Description of Embodiments, Claims, Abstract"

			Next step for you: step 4.
			"
		`);
	});

	it('answered but not applied, findings.md older than the draft', () => {
		expect(render({ featureList: featureList(), claims: claims(), draft, inventorAnswers: answers({ 'IQ-1': 'Grade 304.', 'IQ-2': 'Not stated' }), findings: renderFindingsFile(errors) })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names. The step numbers are the steps of the application-drafting skill.

			- [x] 1. Feature List confirmed: feature-list.md has \`confirmed: true\`
			- [x] 2. Claims approved: claims.md has \`approved: true\`
			- [x] 3. Draft written: draft-application.md
			- [ ] 4. Fix or waive the Errors: findings.md is older than the draft or the claims
			      → Tell the agent: "Validate the draft"
			- [ ] 5. Answer the Inventor Questions: 1 open, 1 answered but not yet in the draft (IQ-1)
			      → Fill each **Answer:** in inventor-answers.md (line 20), or send the file to the inventor
			      → Then tell the agent: "Apply the answers"
			- [ ] 6. Export to Word: blocked by steps 4 and 5

			Not blocking:

			- Figures: figures.md does not exist
			      → When the application has drawings, add one heading per figure to figures.md (e.g. "## FIG. 1") with its parts, or tell the agent: "Build figures.md from the disclosure"
			- Required sections: missing in draft-application.md: Technical Field, Background Art, Summary of the Invention, Description of Embodiments, Claims, Abstract
			      → Tell the agent: "Add the missing sections: Technical Field, Background Art, Summary of the Invention, Description of Embodiments, Claims, Abstract"

			Next step for you: step 4.
			"
		`);
	});

	it('Errors waived and Inventor Questions applied: export is next', () => {
		const waived = errors.map(finding => ({ ...finding, waived: { reason: 'Accepted by the attorney.' } }));
		const applied = draft.replace(/\n## Inventor Questions[\s\S]*$/, '\n');
		expect(render({ featureList: featureList(), claims: claims(), draft: applied, inventorAnswers: answers({ 'IQ-1': 'Grade 304.', 'IQ-2': 'Four millimetres.' }), findings: renderFindingsFile(waived), findingsCurrent: true })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names. The step numbers are the steps of the application-drafting skill.

			- [x] 1. Feature List confirmed: feature-list.md has \`confirmed: true\`
			- [x] 2. Claims approved: claims.md has \`approved: true\`
			- [x] 3. Draft written: draft-application.md
			- [x] 4. Errors fixed or waived: none open in findings.md
			- [x] 5. Inventor Questions answered and applied: none open in draft-application.md
			- [ ] 6. Export to Word: ready
			      → Tell the agent: "Export to Word"

			Not blocking:

			- Figures: figures.md does not exist
			      → When the application has drawings, add one heading per figure to figures.md (e.g. "## FIG. 1") with its parts, or tell the agent: "Build figures.md from the disclosure"
			- Required sections: missing in draft-application.md: Technical Field, Background Art, Summary of the Invention, Description of Embodiments, Claims, Abstract
			      → Tell the agent: "Add the missing sections: Technical Field, Background Art, Summary of the Invention, Description of Embodiments, Claims, Abstract"

			Next step for you: step 6.
			"
		`);
	});

	it('exported: every step is done', () => {
		const applied = draft.replace(/\n## Inventor Questions[\s\S]*$/, '\n');
		expect(render({ featureList: featureList(), claims: claims(), draft: applied, findings: renderFindingsFile([]), findingsCurrent: true, exported: true })).toMatchInlineSnapshot(`
			"# Drafting checklist: hinge (EPO)

			Code writes this file from the files of this folder after every drafting tool call. Do not edit it: edit the file each step names. The step numbers are the steps of the application-drafting skill.

			- [x] 1. Feature List confirmed: feature-list.md has \`confirmed: true\`
			- [x] 2. Claims approved: claims.md has \`approved: true\`
			- [x] 3. Draft written: draft-application.md
			- [x] 4. Errors fixed or waived: none open in findings.md
			- [x] 5. Inventor Questions answered and applied: none open in draft-application.md
			- [x] 6. Exported to Word: draft-application.description.docx, draft-application.claims.docx, draft-application.abstract.docx

			Not blocking:

			- Figures: figures.md does not exist
			      → When the application has drawings, add one heading per figure to figures.md (e.g. "## FIG. 1") with its parts, or tell the agent: "Build figures.md from the disclosure"
			- Required sections: missing in draft-application.md: Technical Field, Background Art, Summary of the Invention, Description of Embodiments, Claims, Abstract
			      → Tell the agent: "Add the missing sections: Technical Field, Background Art, Summary of the Invention, Description of Embodiments, Claims, Abstract"

			Next step for you: none. Review the Word files: they are a draft for attorney review, not a filing.
			"
		`);
	});

	it('a refusal points to the open checklist steps', () => {
		const checklist = readDraftingChecklist({ matter: 'hinge', featureList: featureList(), claims: claims(), draft, inventorAnswers: answers(), findings: renderFindingsFile(errors), findingsCurrent: true, exported: false });
		expect(checklistPointer(checklist, 'drafting/hinge/checklist.md')).toBe('Open in drafting/hinge/checklist.md: step 4 (Fix or waive the Errors), step 5 (Answer the Inventor Questions).');
	});

	it('the notes never block: figures, required sections and style exemplars, each with what to do', () => {
		const notes = (files: Partial<DraftingChecklistFiles>) => render(files).split('\n').filter((line, index, lines) => index > lines.indexOf('Not blocking:') && line && !line.startsWith('Next step'));
		const noSections = `---\noffice: EPO\n---\n# Hinge\n\n## Summary\n\n<!-- src: feature:F1 -->\nA lever.\n`;
		expect({
			nothing: notes({ styleExemplars: 7 }),
			gaps: notes({ featureList: featureList(), claims: claims(), draft: noSections, figures: '# Figures\n\n## FIG. 1\n\n- 10: lever\n\n## FIGS. 2 to 4\n', styleExemplars: 1 }),
		}).toEqual({
			nothing: [
				'- Figures: figures.md does not exist',
				'      → When the application has drawings, add one heading per figure to figures.md (e.g. "## FIG. 1") with its parts, or tell the agent: "Build figures.md from the disclosure"',
				'- Style exemplars: 7 files in style/ (only the first 5 are read)',
				'      → Put 1 to 5 of your own filed applications or claim sets in style/ (.md, .docx, .pdf). FlowLeap copies their voice and structure only, never their facts. Leave the folder empty to use the office template style.',
			],
			gaps: [
				'- Figures: 4 in figures.md',
				'- Required sections: missing in draft-application.md: Technical Field, Background Art, Brief Description of the Drawings, Description of Embodiments, Claims, Abstract',
				'      → Tell the agent: "Add the missing sections: Technical Field, Background Art, Brief Description of the Drawings, Description of Embodiments, Claims, Abstract"',
				'- Style exemplars: 1 file in style/',
				'      → Put 1 to 5 of your own filed applications or claim sets in style/ (.md, .docx, .pdf). FlowLeap copies their voice and structure only, never their facts. Leave the folder empty to use the office template style.',
			],
		});
	});

	it('claims changed since approval, a draft for other claims and an export of an older draft are not done, and export is not ready', () => {
		const steps = (files: Partial<DraftingChecklistFiles>) => readDraftingChecklist({ matter: 'hinge', findingsCurrent: true, exported: false, ...files }).steps.map(entry => `${entry.step} ${entry.done ? 'x' : ' '} ${entry.detail}`);
		const applied = draft.replace(/\n## Inventor Questions[\s\S]*$/, '\n');
		const base = { featureList: featureList(), claims: claims(), draft: applied, findings: renderFindingsFile([]) };
		expect({
			claimsChanged: steps({ ...base, claimsChangedSinceApproval: true, exported: true }),
			draftStale: steps({ ...base, draftStale: true }),
			exportedOlderDraft: steps({ ...base, exported: false }).at(-1),
		}).toEqual({
			claimsChanged: [
				'1 x feature-list.md has `confirmed: true`',
				'2   claims.md changed after it was approved',
				'3 x draft-application.md',
				'4 x none open in findings.md',
				'5 x none open in draft-application.md',
				'6   blocked by step 2',
			],
			draftStale: [
				'1 x feature-list.md has `confirmed: true`',
				'2 x claims.md has `approved: true`',
				'3   draft-application.md was written for other claims than claims.md',
				'4 x none open in findings.md',
				'5 x none open in draft-application.md',
				'6   blocked by step 3',
			],
			exportedOlderDraft: '6   ready',
		});
	});

	it('a question removed from the draft while its narrowed question has no answer stays open in step 5', () => {
		const answers = updateInventorAnswers(undefined, 'hinge', parseInventorQuestions(draft), new Set())
			.replace('**Question:** Which steel grade?\n\n**Belongs:** see the question\n\n**Answer:**\n', '**Question:** Which steel grade?\n\n**Belongs:** see the question\n\n**Answer:**\nStainless; hardness unknown.\n\n**Narrowed question:** What hardness?\n\n**Answer:**\n');
		const withoutIq1 = draft.replace('> **Inventor Question IQ-1:** Which steel grade?\n\n', '');
		const step5 = readDraftingChecklist({ matter: 'hinge', featureList: featureList(), claims: claims(), draft: withoutIq1, inventorAnswers: answers, findings: renderFindingsFile([]), findingsCurrent: true, exported: false }).steps[4];
		expect([step5.detail, ...step5.actions]).toEqual([
			'2 open, 1 removed from the draft without an answer (IQ-1)',
			'→ Fill each **Answer:** in inventor-answers.md (lines 24, 16), or send the file to the inventor',
			'→ Then tell the agent: "Apply the answers"',
		]);
	});
});
