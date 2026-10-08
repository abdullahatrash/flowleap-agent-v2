/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The filing manifest of a Draft Application export (`filing-manifest.md`): the values the
 * applicant declares by hand at filing — claims, drawing sheets, the figure to publish with the
 * abstract and the page counts. Page counts cannot be measured without a renderer, so they are an
 * estimate from the exported text under the office page setup, and the manifest says so.
 */

import { parseClaims } from './claims';
import { DraftFinding } from './finding';
import { documentParagraphs, exportedParagraphs, FilingParagraph, OFFICE_PAGE_SETUP, OfficePageSetup } from './filingDocuments';
import { DRAFT_DOCUMENT_TYPES, DRAFTING_FILE_NAMES, DraftDocumentType, DraftingFolder } from './folderContract';
import { DraftingFrontmatterValue, DraftingOffice, parseDraftingFrontmatter } from './frontmatter';
import { isAbstractParagraph, parseFigureParts } from './specValidators';

/** Average character width of body text, in ems (a conservative value for a serif font). */
const AVERAGE_CHARACTER_WIDTH_EM = 0.5;

const MILLIMETRES_PER_POINT = 25.4 / 72;

/** The EPO page fee is due for each page over this count (Rule 38(2) EPC; RFees Art. 2(1) item 1a). */
const EPO_PAGE_FEE_THRESHOLD = 35;

/** The pages the abstract counts for the EPO page fee, whatever its length (Rule 38(3) EPC). */
const EPO_ABSTRACT_FEE_PAGES = 1;

/** The basis of the page estimate of one office page setup. */
export interface PageEstimateBasis {
	readonly charactersPerLine: number;
	/** The text lines of a page, less the line of the page number. */
	readonly linesPerPage: number;
}

/**
 * Characters per line: the text width over the average character width (half the font size).
 * Lines per page: the text height over the line pitch (font size times line spacing), less one
 * line for the page number.
 */
export function pageEstimateBasis(setup: OfficePageSetup): PageEstimateBasis {
	const { margins } = setup;
	const characterWidth = AVERAGE_CHARACTER_WIDTH_EM * setup.fontSize * MILLIMETRES_PER_POINT;
	const linePitch = setup.lineSpacing * setup.fontSize * MILLIMETRES_PER_POINT;
	return {
		charactersPerLine: Math.floor((setup.width - margins.left - margins.right) / characterWidth),
		linesPerPage: Math.floor((setup.height - margins.top - margins.bottom) / linePitch) - 1,
	};
}

/**
 * The estimated pages of one document: each paragraph takes its wrapped lines plus one line of
 * paragraph spacing (the export sets one line after each paragraph); the lines fill whole pages.
 * `**bold**` marks are not counted. A document without paragraphs has no pages.
 */
export function estimatePages(paragraphs: readonly FilingParagraph[], setup: OfficePageSetup): number {
	const { charactersPerLine, linesPerPage } = pageEstimateBasis(setup);
	const lines = paragraphs.reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.text.replace(/\*\*/g, '').length / charactersPerLine)) + 1, 0);
	return Math.ceil(lines / linesPerPage);
}

/** The drafting files a filing manifest is computed from. */
export interface FilingManifestInput {
	readonly office: DraftingOffice;
	/** `draft-application.md`. */
	readonly draft: string;
	/** `claims.md`. */
	readonly claims: string;
	/** `figures.md`; absent when the application has no figures. */
	readonly figures?: string;
}

/** The values of a filing manifest. */
export interface FilingManifest {
	readonly office: DraftingOffice;
	readonly title?: string;
	/** The `language` of the draft frontmatter; absent when the draft does not set it. */
	readonly language?: string;
	readonly claims: { readonly total: number; readonly independent: number };
	/** The figure headings of `figures.md`, in order. */
	readonly figures: readonly string[];
	/** `drawingSheets` of `figures.md` when set, else one sheet per figure. */
	readonly drawingSheets: number;
	readonly drawingSheetsDeclared: boolean;
	/** The figure whose reference numerals the abstract names most, else the first figure. */
	readonly abstractFigure?: string;
	/** Estimated pages per document type; the drawings are the drawing sheets; the total counts all. */
	readonly pages: Readonly<Record<DraftDocumentType | 'drawings' | 'total', number>>;
	/**
	 * The estimated pages counted for the EPO page fee: the description, the claims and the
	 * drawing sheets, and the abstract as one page when there is one (Rule 38(3) EPC).
	 */
	readonly pagesForPageFee: number;
}

interface FigureEntry {
	readonly label: string;
	readonly numerals: readonly string[];
}

/** The figures of `figures.md`: each heading, with the numerals of the parts listed under it. */
function parseFigures(figures: string): FigureEntry[] {
	const { body, bodyStartLine } = parseDraftingFrontmatter(figures);
	const headings = body.split('\n')
		.map((content, index) => ({ label: /^#{1,6}\s+(?<label>.+?)\s*#*\s*$/.exec(content)?.groups?.label, line: bodyStartLine + index }))
		.filter((heading): heading is { label: string; line: number } => heading.label !== undefined);
	const parts = parseFigureParts(figures);
	return headings.map((heading, index) => {
		const end = headings[index + 1]?.line ?? Infinity;
		return { label: heading.label, numerals: parts.filter(part => part.line > heading.line && part.line < end).map(part => part.numeral) };
	});
}

function proposeAbstractFigure(figures: readonly FigureEntry[], abstract: string): string | undefined {
	let best: { label: string; count: number } | undefined;
	for (const figure of figures) {
		const count = figure.numerals.filter(numeral => new RegExp(`(?<![\\w.])${numeral}(?!\\w|\\.\\d)`).test(abstract)).length;
		if (!best || count > best.count) {
			best = { label: figure.label, count };
		}
	}
	return best?.label;
}

function frontmatterText(value: DraftingFrontmatterValue): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Computes the filing manifest of a draft from the drafting files. */
export function filingManifest(input: FilingManifestInput): FilingManifest {
	const setup = OFFICE_PAGE_SETUP[input.office];
	const { fields } = parseDraftingFrontmatter(input.draft);
	const claims = parseClaims(input.claims);
	const figures = parseFigures(input.figures ?? '');
	const declaredSheets = parseDraftingFrontmatter(input.figures ?? '').fields.drawingSheets;
	const drawingSheetsDeclared = typeof declaredSheets === 'number' && Number.isInteger(declaredSheets) && declaredSheets >= 0;
	const drawingSheets = drawingSheetsDeclared ? declaredSheets : figures.length;

	const paragraphs = exportedParagraphs(input.draft);
	const documents = documentParagraphs(paragraphs);
	const description = estimatePages(documents.description, setup);
	const claimPages = estimatePages(documents.claims, setup);
	const abstract = estimatePages(documents.abstract, setup);
	const abstractText = paragraphs.filter(paragraph => paragraph.kind === 'text' && isAbstractParagraph(paragraph)).map(paragraph => paragraph.text).join('\n');
	const title = frontmatterText(fields.title)
		?? paragraphs.find(paragraph => paragraph.kind === 'heading' && /^#\s/.test(paragraph.text))?.section
		?? paragraphs.find(paragraph => paragraph.kind === 'heading')?.section;

	return {
		office: input.office,
		title,
		language: frontmatterText(fields.language),
		claims: { total: claims.length, independent: claims.filter(claim => !claim.dependsOn.length).length },
		figures: figures.map(figure => figure.label),
		drawingSheets,
		drawingSheetsDeclared,
		abstractFigure: proposeAbstractFigure(figures, abstractText),
		pages: { description, claims: claimPages, abstract, drawings: drawingSheets, total: description + claimPages + abstract + drawingSheets },
		pagesForPageFee: description + claimPages + Math.min(abstract, EPO_ABSTRACT_FEE_PAGES) + drawingSheets,
	};
}

/**
 * A Note when an EPO application has more than 35 pages for the page fee, drawing sheets included
 * and the abstract counted as one page (Rule 38(2) and (3) EPC; RFees Art. 2(1) item 1a). The
 * page count is estimated from the draft text, so the Note is reported against the draft. The
 * claim count Notes come from the claim validators.
 */
export function checkPageCount(manifest: FilingManifest): DraftFinding[] {
	const { pages, pagesForPageFee } = manifest;
	if (manifest.office !== 'EPO' || pagesForPageFee <= EPO_PAGE_FEE_THRESHOLD) {
		return [];
	}
	return [{
		severity: 'Note',
		rule: 'page-count',
		file: DRAFTING_FILE_NAMES.draft,
		message: `About ${pagesForPageFee} pages count for the page fee (estimated from the draft text: description ${pages.description}, claims ${pages.claims}, abstract ${Math.min(pages.abstract, EPO_ABSTRACT_FEE_PAGES)}, drawings ${pages.drawings}): the EPO page fee is due for each page over ${EPO_PAGE_FEE_THRESHOLD} (Rule 38(3) EPC; RFees Art. 2(1) item 1a). Check the page count in Word before filing.`,
	}];
}

const documentLabels: Record<DraftDocumentType, string> = { description: 'Description', claims: 'Claims', abstract: 'Abstract' };

/** Renders `filing-manifest.md` for the files of an export. */
export function renderFilingManifest(manifest: FilingManifest, folder: DraftingFolder): string {
	const setup = OFFICE_PAGE_SETUP[manifest.office];
	const basis = pageEstimateBasis(setup);
	const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
	const sheets = manifest.drawingSheetsDeclared
		? `${manifest.drawingSheets} (\`drawingSheets\` in ${DRAFTING_FILE_NAMES.figures})`
		: `${manifest.drawingSheets} (one sheet per figure in ${DRAFTING_FILE_NAMES.figures}; set \`drawingSheets\` in its frontmatter when figures share a sheet)`;
	const abstractFigure = manifest.abstractFigure
		? `${manifest.abstractFigure} (proposed: the figure whose reference numerals the abstract names most; the attorney confirms it)`
		: 'None (no figures)';
	const lines = [
		`# Filing manifest — ${folder.matter}`,
		'',
		'Written by export_draft_docx from the exported files: the values the applicant declares at filing. The page counts are **estimated** from the text under the page setup, not measured in Word; check them in Word before filing. A draft for attorney review, not a filing.',
		'',
		'| Item | Value |',
		'| --- | --- |',
		`| Title | ${manifest.title ?? 'Not found (no title heading)'} |`,
		`| Language | ${manifest.language ?? 'Not set (`language` in the draft frontmatter)'} |`,
		`| Office | ${manifest.office} (${setup.rule} page setup, ${setup.paper}) |`,
		`| Claims | ${manifest.claims.total} in total, ${manifest.claims.independent} independent |`,
		`| Drawing sheets | ${sheets} |`,
		`| Figures | ${manifest.figures.length ? manifest.figures.join(', ') : 'None'} |`,
		`| Abstract figure | ${abstractFigure} |`,
		'',
		'## Pages (estimated)',
		'',
		`Estimated at ${basis.charactersPerLine} characters per line and ${basis.linesPerPage} lines per page (${setup.fontSize} pt, ${setup.lineSpacing} line spacing, one line between paragraphs).`,
		'',
		'| Document | File | Pages |',
		'| --- | --- | --- |',
		...DRAFT_DOCUMENT_TYPES.map(type => `| ${documentLabels[type]} | ${fileName(folder.docx[type])} | ${manifest.pages[type]} |`),
		`| Drawings | Not generated: prepared outside FlowLeap | ${manifest.pages.drawings} |`,
		`| Total | | ${manifest.pages.total} |`,
		...(manifest.office === 'EPO' ? [
			'',
			`Pages counted for the page fee: ${manifest.pagesForPageFee} (the abstract counts as one page, Rule 38(3) EPC; the EPO page fee is due for each page over ${EPO_PAGE_FEE_THRESHOLD}, RFees Art. 2(1) item 1a).`,
		] : []),
	];
	return lines.join('\n') + '\n';
}
