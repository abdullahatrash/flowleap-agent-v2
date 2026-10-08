/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { INVENTOR_QUESTION } from '../common/drafting/finding';
import { DraftingOffice } from '../common/drafting/frontmatter';
import { DraftParagraph, parseDraftParagraphs, stripSourceMarkers } from '../common/drafting/sourceMarkers';
import { isAbstractParagraph, isClaimsParagraph } from '../common/drafting/specValidators';

const headingLevels = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5];

const claimStart = /^\s*\d+\s*[.)]\s+/;

/**
 * The recognised top-level sections of each office, in filing order: US 37 CFR 1.77(b) and EPO
 * Rule 42(1) EPC, as the application-drafting skill references list them. Claims and Abstract
 * are always last (see {@link sectionRank}).
 */
const officeSections: Record<DraftingOffice, readonly RegExp[]> = {
	US: [
		/cross[- ]?reference/,
		/federally sponsored|government (?:interest|rights|support)/,
		/joint research/,
		/sequence listing|program listing|table appendix/,
		/prior disclosures?/,
		/\bfield\b/,
		/background/,
		/summary/,
		/brief description|drawings/,
		/detailed description|description of (?:the )?(?:preferred )?embodiments?/,
	],
	EPO: [
		/\bfield\b/,
		/background|prior art/,
		/summary|disclosure of the invention|technical problem|problem and (?:its )?solution/,
		/brief description|drawings/,
		/detailed description|embodiments?|carrying out/,
		/industrial applica/,
	],
};

const CLAIMS_RANK = 1000;
const ABSTRACT_RANK = 1001;

/** The filing position of a section heading for the office, or `undefined` when it is not recognised. */
function sectionRank(heading: DraftParagraph, office: DraftingOffice): number | undefined {
	if (isClaimsParagraph(heading)) {
		return CLAIMS_RANK;
	}
	if (isAbstractParagraph(heading)) {
		return ABSTRACT_RANK;
	}
	const title = (heading.section ?? '').toLowerCase();
	const index = officeSections[office].findIndex(pattern => pattern.test(title));
	return index < 0 ? undefined : index;
}

function headingLevel(paragraph: DraftParagraph): number {
	return /^(?<hashes>#+)/.exec(paragraph.text)?.groups?.hashes.length ?? 1;
}

interface DraftSection {
	readonly rank: number | undefined;
	readonly paragraphs: DraftParagraph[];
}

/**
 * Puts the top-level sections of a draft in the office section order. A section the office list
 * does not name keeps its place after the recognised section it followed (at the front when none
 * did; before the Claims when it followed the Claims or the Abstract). The text before the first
 * section (the title) stays first.
 */
function orderSections(paragraphs: readonly DraftParagraph[], office: DraftingOffice): DraftParagraph[] {
	const headings = paragraphs.filter(paragraph => paragraph.kind === 'heading');
	const titleIsHeading = headings.length > 1 && headingLevel(headings[0]) === 1 && headings.slice(1).every(heading => headingLevel(heading) > 1);
	const sectionHeadings = titleIsHeading ? headings.slice(1) : headings;
	if (!sectionHeadings.length) {
		return [...paragraphs];
	}
	const sectionLevel = Math.min(...sectionHeadings.map(headingLevel));
	const front: DraftParagraph[] = [];
	const sections: DraftSection[] = [];
	for (const paragraph of paragraphs) {
		if (paragraph.kind === 'heading' && sectionHeadings.includes(paragraph) && headingLevel(paragraph) === sectionLevel) {
			sections.push({ rank: sectionRank(paragraph, office), paragraphs: [paragraph] });
		} else {
			(sections.at(-1)?.paragraphs ?? front).push(paragraph);
		}
	}

	const body: { rank: number; paragraphs: DraftParagraph[] }[] = [];
	const end: { rank: number; paragraphs: DraftParagraph[] }[] = [];
	const beforeClaims: DraftParagraph[] = [];
	let last: { rank: number; paragraphs: DraftParagraph[] } | undefined;
	for (const section of sections) {
		if (section.rank === undefined) {
			const target = !last ? front : last.rank >= CLAIMS_RANK ? beforeClaims : last.paragraphs;
			target.push(...section.paragraphs);
			continue;
		}
		last = { rank: section.rank, paragraphs: [...section.paragraphs] };
		(section.rank >= CLAIMS_RANK ? end : body).push(last);
	}
	const byRank = (a: { rank: number }, b: { rank: number }) => a.rank - b.rank;
	return [
		...front,
		...body.sort(byRank).flatMap(section => section.paragraphs),
		...beforeClaims,
		...end.sort(byRank).flatMap(section => section.paragraphs),
	];
}

/** `**bold**` spans become bold runs; all other text is literal. */
function runs(text: string): TextRun[] {
	return text.split(/(?<bold>\*\*[^*]+\*\*)/g).filter(Boolean).map(part => /^\*\*[^*]+\*\*$/.test(part) ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part));
}

function joinLines(text: string): string {
	return text.split('\n').map(line => line.trim()).filter(Boolean).join(' ');
}

/**
 * Builds the .docx of a Draft Application: source markers stripped, frontmatter, Inventor
 * Question blocks and the `Inventor Questions` section left out. The top-level sections are put
 * in the office section order (US 37 CFR 1.77(b), EPO Rule 42(1) EPC), with their headings as the
 * draft writes them; the Claims and the Abstract come last and start on a new page, and each
 * claim is its own numbered paragraph.
 */
export async function buildDraftDocx(draft: string, office: DraftingOffice): Promise<Uint8Array> {
	const paragraphs = parseDraftParagraphs(stripSourceMarkers(draft))
		.filter(paragraph => paragraph.kind !== INVENTOR_QUESTION && !/^inventor questions?$/i.test(paragraph.section ?? ''));
	const children: Paragraph[] = [];
	for (const paragraph of orderSections(paragraphs, office)) {
		if (paragraph.kind === 'heading') {
			children.push(new Paragraph({
				children: runs(paragraph.section ?? ''),
				heading: headingLevels[Math.min(headingLevel(paragraph), headingLevels.length) - 1],
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
