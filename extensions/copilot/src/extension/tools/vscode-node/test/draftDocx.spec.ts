/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import { buildDraftDocx } from '../draftDocx';

/** A draft of the given section headings, each with one marked paragraph naming its section. */
function draft(...headings: string[]): string {
	return headings.map(heading => `${heading}\n\n<!-- src: template -->\nText of ${heading.replace(/^#+\s*/, '')}.`).join('\n\n');
}

async function docxLines(text: string, office: 'US' | 'EPO'): Promise<string[]> {
	const docx = await buildDraftDocx(text, office);
	return (await mammoth.extractRawText({ buffer: Buffer.from(docx) })).value.split('\n').filter(Boolean);
}

describe('buildDraftDocx section order', () => {

	it('US: orders the sections as 37 CFR 1.77(b), keeps an unknown section after the one it followed, Claims and Abstract last', async () => {
		expect(await docxLines(draft('# Hinge', '## DETAILED DESCRIPTION', '## Custom Notes', '## BACKGROUND', '## SUMMARY', '## ABSTRACT', '## CLAIMS', '## CROSS-REFERENCE TO RELATED APPLICATIONS', '## BRIEF DESCRIPTION OF THE DRAWINGS', '## Inventor Questions'), 'US')).toEqual([
			'Hinge', 'Text of Hinge.',
			'CROSS-REFERENCE TO RELATED APPLICATIONS', 'Text of CROSS-REFERENCE TO RELATED APPLICATIONS.',
			'BACKGROUND', 'Text of BACKGROUND.',
			'SUMMARY', 'Text of SUMMARY.',
			'BRIEF DESCRIPTION OF THE DRAWINGS', 'Text of BRIEF DESCRIPTION OF THE DRAWINGS.',
			'DETAILED DESCRIPTION', 'Text of DETAILED DESCRIPTION.',
			'Custom Notes', 'Text of Custom Notes.',
			'CLAIMS', 'Text of CLAIMS.',
			'ABSTRACT', 'Text of ABSTRACT.',
		]);
	});

	it('EPO: orders the sections as Rule 42(1) EPC, sub-sections moving with their section', async () => {
		expect(await docxLines(draft('# Hinge', '## Summary of the invention', '## Technical field', '## Industrial application', '## Background art', '## Detailed description of embodiments', '### First embodiment', '## Brief description of the drawings', '## Abstract', '## Claims'), 'EPO')).toEqual([
			'Hinge', 'Text of Hinge.',
			'Technical field', 'Text of Technical field.',
			'Background art', 'Text of Background art.',
			'Summary of the invention', 'Text of Summary of the invention.',
			'Brief description of the drawings', 'Text of Brief description of the drawings.',
			'Detailed description of embodiments', 'Text of Detailed description of embodiments.',
			'First embodiment', 'Text of First embodiment.',
			'Industrial application', 'Text of Industrial application.',
			'Claims', 'Text of Claims.',
			'Abstract', 'Text of Abstract.',
		]);
	});
});
