/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { parseDraftParagraphs, stripSourceMarkers } from '../common/drafting/sourceMarkers';
import { isAbstractParagraph, isClaimsParagraph } from '../common/drafting/specValidators';

const headingLevels = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5];

const claimStart = /^\s*\d+\s*[.)]\s+/;

/** `**bold**` spans become bold runs; all other text is literal. */
function runs(text: string): TextRun[] {
	return text.split(/(?<bold>\*\*[^*]+\*\*)/g).filter(Boolean).map(part => /^\*\*[^*]+\*\*$/.test(part) ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part));
}

function joinLines(text: string): string {
	return text.split('\n').map(line => line.trim()).filter(Boolean).join(' ');
}

/**
 * Builds the .docx of a Draft Application: source markers stripped, frontmatter, Inventor
 * Question blocks and the `Inventor Questions` section left out. Sections keep the order and the
 * headings of the draft (the office section order the skill writes); the Claims and the Abstract
 * start on a new page, and each claim is its own numbered paragraph.
 */
export async function buildDraftDocx(draft: string): Promise<Uint8Array> {
	const children: Paragraph[] = [];
	for (const paragraph of parseDraftParagraphs(stripSourceMarkers(draft))) {
		if (paragraph.kind === 'inventor-question' || /^inventor questions?$/i.test(paragraph.section ?? '')) {
			continue;
		}
		if (paragraph.kind === 'heading') {
			const level = /^(?<hashes>#+)/.exec(paragraph.text)?.groups?.hashes.length ?? 1;
			children.push(new Paragraph({
				children: runs(paragraph.section ?? ''),
				heading: headingLevels[Math.min(level, headingLevels.length) - 1],
				pageBreakBefore: isClaimsParagraph(paragraph) || isAbstractParagraph(paragraph),
			}));
			continue;
		}
		if (isClaimsParagraph(paragraph)) {
			const claims: string[] = [];
			for (const line of paragraph.text.split('\n')) {
				if (claimStart.test(line) || !claims.length) {
					claims.push(line.trim());
				} else {
					claims[claims.length - 1] += ` ${line.trim()}`;
				}
			}
			children.push(...claims.map(claim => new Paragraph({ children: runs(claim) })));
			continue;
		}
		children.push(new Paragraph({ children: runs(joinLines(paragraph.text)) }));
	}
	return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}
