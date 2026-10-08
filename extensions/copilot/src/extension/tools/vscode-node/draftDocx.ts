/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AlignmentType, Document, Footer, Header, HeadingLevel, ISectionOptions, LineNumberRestartFormat, Packer, PageNumber, Paragraph, TextRun } from 'docx';
import { documentParagraphs, exportedParagraphs, FilingParagraph, OFFICE_PAGE_SETUP, OfficePageSetup, orderSections } from '../common/drafting/filingDocuments';
import { DRAFT_DOCUMENT_TYPES, DraftDocumentType } from '../common/drafting/folderContract';
import { DraftingOffice } from '../common/drafting/frontmatter';
import { REVIEW_COPY_MARK, ReviewCopyBlock } from '../common/drafting/fullReviewCopy';

const headingLevels = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5];

/** `**bold**` spans become bold runs; all other text is literal. */
function runs(text: string): TextRun[] {
	return text.split(/(?<bold>\*\*[^*]+\*\*)/g).filter(Boolean).map(part => /^\*\*[^*]+\*\*$/.test(part) ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part));
}

/** Millimetres in twentieths of a point, the unit of the .docx page setup. */
function twips(millimetres: number): number {
	return Math.round(millimetres / 25.4 * 1440);
}

/**
 * The centred page number, in the header or the footer the office names. A `mark` goes to the
 * header of every page, above the page number when that is in the header.
 */
function pageNumberBlock(setup: OfficePageSetup, mark?: string): Pick<ISectionOptions, 'headers' | 'footers'> {
	const children = [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })];
	const marked = mark ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: mark, bold: true })] })] : [];
	return setup.pageNumbers === 'top'
		? { headers: { default: new Header({ children: [...marked, ...children] }) } }
		: { ...(marked.length ? { headers: { default: new Header({ children: marked }) } } : {}), footers: { default: new Footer({ children }) } };
}

/**
 * One filing document with the office page setup. The header and the footer sit at the margin
 * edge, so the page number is not in the margin and the text starts below or ends above it.
 */
async function packDocument(children: Paragraph[], type: DraftDocumentType | undefined, setup: OfficePageSetup, mark?: string): Promise<Uint8Array> {
	const { margins } = setup;
	const lineNumbers = type && setup.lineNumbers?.documents.includes(type) ? { countBy: setup.lineNumbers.every, restart: LineNumberRestartFormat.NEW_PAGE } : undefined;
	const spacing = Math.round(setup.lineSpacing * 240);
	const document = new Document({
		styles: {
			default: {
				document: {
					run: { font: 'Times New Roman', size: setup.fontSize * 2 },
					// The office line spacing (`setup.lineSpacing`), and one such line between paragraphs.
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
			...pageNumberBlock(setup, mark),
			children,
		}],
	});
	return new Uint8Array(await Packer.toBuffer(document));
}

function toDocx(filing: FilingParagraph): Paragraph {
	return filing.kind === 'heading'
		? new Paragraph({ children: runs(filing.text), heading: headingLevels[Math.min(filing.level ?? 1, headingLevels.length) - 1] })
		: new Paragraph({ children: runs(filing.text) });
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
	const documents = documentParagraphs(orderSections(exportedParagraphs(draft), office));
	const setup = OFFICE_PAGE_SETUP[office];
	const [description, claims, abstract] = await Promise.all(DRAFT_DOCUMENT_TYPES.map(type => packDocument(documents[type].map(toDocx), type, setup)));
	return { description, claims, abstract };
}

/**
 * Packs the full review copy (`composeFullReviewCopy`) as one .docx with the office page
 * setup and the mark "Draft for attorney review — not for filing" in the header of every page.
 * A missing part is bold and highlighted. No line numbers: it is a copy to read, not to file.
 */
export function buildFullReviewCopyDocx(blocks: readonly ReviewCopyBlock[], office: DraftingOffice): Promise<Uint8Array> {
	const children: Paragraph[] = [];
	let breakBefore = false;
	for (const block of blocks) {
		if (block.kind === 'pageBreak') {
			breakBefore = true;
			continue;
		}
		const paragraph = block.kind === 'missing'
			? new Paragraph({ pageBreakBefore: breakBefore, children: [new TextRun({ text: block.text, bold: true, highlight: 'yellow' })] })
			: block.kind === 'heading'
				? new Paragraph({ pageBreakBefore: breakBefore, children: runs(block.text), heading: headingLevels[Math.min(block.level, headingLevels.length) - 1] })
				: new Paragraph({ pageBreakBefore: breakBefore, children: runs(block.text) });
		children.push(paragraph);
		breakBefore = false;
	}
	return packDocument(children, undefined, OFFICE_PAGE_SETUP[office], REVIEW_COPY_MARK);
}
