/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AlignmentType, Document, Footer, Header, HeadingLevel, ISectionOptions, LineNumberRestartFormat, Packer, PageNumber, Paragraph, TextRun } from 'docx';
import { documentTypeOf, exportedParagraphs, filingParagraphs, headingLevel, OFFICE_PAGE_SETUP, OfficePageSetup } from '../common/drafting/filingDocuments';
import { DRAFT_DOCUMENT_TYPES, DraftDocumentType } from '../common/drafting/folderContract';
import { DraftingOffice } from '../common/drafting/frontmatter';
import { DraftParagraph } from '../common/drafting/sourceMarkers';
import { isAbstractParagraph, isClaimsParagraph } from '../common/drafting/specValidators';

const headingLevels = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5];

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

/** Millimetres in twentieths of a point, the unit of the .docx page setup. */
function twips(millimetres: number): number {
	return Math.round(millimetres / 25.4 * 1440);
}

/** The centred page number, in the header or the footer the office names. */
function pageNumberBlock(setup: OfficePageSetup): Pick<ISectionOptions, 'headers' | 'footers'> {
	const children = [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })];
	return setup.pageNumbers === 'top' ? { headers: { default: new Header({ children }) } } : { footers: { default: new Footer({ children }) } };
}

/**
 * One filing document with the office page setup. The header and the footer sit at the margin
 * edge, so the page number is not in the margin and the text starts below or ends above it.
 */
async function packDocument(children: Paragraph[], type: DraftDocumentType, setup: OfficePageSetup): Promise<Uint8Array> {
	const { margins } = setup;
	const lineNumbers = setup.lineNumbers?.documents.includes(type) ? { countBy: setup.lineNumbers.every, restart: LineNumberRestartFormat.NEW_PAGE } : undefined;
	const spacing = Math.round(setup.lineSpacing * 240);
	const document = new Document({
		styles: {
			default: {
				document: {
					run: { font: 'Times New Roman', size: setup.fontSize * 2 },
					// 1.5 line spacing, and one such line between paragraphs.
					paragraph: { spacing: { line: spacing, after: Math.round(setup.lineSpacing * setup.fontSize * 20) } },
				},
			},
		},
		sections: [{
			properties: {
				page: {
					size: { width: twips(setup.width), height: twips(setup.height) },
					margin: { top: twips(margins.top), right: twips(margins.right), bottom: twips(margins.bottom), left: twips(margins.left), header: twips(margins.top), footer: twips(margins.bottom) },
				},
				lineNumbers,
			},
			...pageNumberBlock(setup),
			children,
		}],
	});
	return new Uint8Array(await Packer.toBuffer(document));
}

/** The export of a Draft Application: one .docx per document type. */
export type DraftDocuments = Readonly<Record<DraftDocumentType, Uint8Array>>;

/**
 * Builds the .docx files of a Draft Application, one per document type (description, claims,
 * abstract), with the office page setup ({@link OFFICE_PAGE_SETUP}: EPO Rule 49 EPC, US 37 CFR
 * 1.52). Source markers are stripped; frontmatter, Inventor Question blocks and the
 * `Inventor Questions` section are left out. The top-level sections are put in the office section
 * order (US 37 CFR 1.77(b), EPO Rule 42(1) EPC), with their headings as the draft writes them;
 * the Claims go to the claims file, one paragraph per numbered claim, and the Abstract to the
 * abstract file. Drawings are not generated.
 */
export async function buildDraftDocx(draft: string, office: DraftingOffice): Promise<DraftDocuments> {
	const children: Record<DraftDocumentType, Paragraph[]> = { description: [], claims: [], abstract: [] };
	for (const paragraph of orderSections(exportedParagraphs(draft), office)) {
		children[documentTypeOf(paragraph)].push(...filingParagraphs(paragraph).map(filing => filing.kind === 'heading'
			? new Paragraph({ children: runs(filing.text), heading: headingLevels[Math.min(filing.level ?? 1, headingLevels.length) - 1] })
			: new Paragraph({ children: runs(filing.text) })));
	}
	const setup = OFFICE_PAGE_SETUP[office];
	const [description, claims, abstract] = await Promise.all(DRAFT_DOCUMENT_TYPES.map(type => packDocument(children[type], type, setup)));
	return { description, claims, abstract };
}
