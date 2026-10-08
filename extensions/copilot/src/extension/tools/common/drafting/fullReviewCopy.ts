/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The full review copy of a Draft Application (`draft-application.full.docx`): the whole
 * application as one document, laid out like a published patent, for the attorney to read. It is
 * rebuilt on every export and marked "Draft for attorney review — not for filing"; the three
 * filing files stay as they are. In office order:
 *
 * 1. Front page: title, office, empty applicant and inventor slots, the abstract with the
 *    proposed abstract figure.
 * 2. Description in the office section order, text paragraphs numbered [0001], [0002], ...
 * 3. Claims.
 * 4. Abstract.
 * 5. Drawings: one page per figure of `figures.md`, with its label and parts.
 * 6. EPO only: the list of reference signs.
 *
 * A missing part is a visible `[MISSING: ...]` placeholder in its place that names where the
 * attorney fills it: a Drafting Checklist note (figures, or the required sections and parts).
 */

import { CHECKLIST_NOTE } from './checklist';
import { documentTypeOf, exportedParagraphs, FilingParagraph, filingParagraphs, missingSections, OFFICE_SECTIONS, orderSections, sectionRank } from './filingDocuments';
import { FilingManifest } from './filingManifest';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftingOffice } from './frontmatter';
import { parseFigureSections } from './specValidators';

/** The mark on every page of the full review copy. */
export const REVIEW_COPY_MARK = 'Draft for attorney review — not for filing';

/** One block of the full review copy. A `missing` block is a placeholder the reader must see. */
export type ReviewCopyBlock =
	| { readonly kind: 'heading'; readonly level: number; readonly text: string }
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'missing'; readonly text: string }
	| { readonly kind: 'pageBreak' };

/** The drafting files the full review copy is composed from. */
export interface FullReviewCopyInput {
	readonly office: DraftingOffice;
	/** `draft-application.md`. */
	readonly draft: string;
	/** `figures.md`; absent when the application has no figures. */
	readonly figures?: string;
	/** The filing manifest of the same export: title and proposed abstract figure. */
	readonly manifest: FilingManifest;
}

const checklistFile = DRAFTING_FILE_NAMES.checklist;

function heading(level: number, text: string): ReviewCopyBlock {
	return { kind: 'heading', level, text };
}

function text(value: string): ReviewCopyBlock {
	return { kind: 'text', text: value };
}

const pageBreak: ReviewCopyBlock = { kind: 'pageBreak' };

/** A placeholder that names where the attorney fills the gap: a checklist step or note. */
function missing(what: string, why: string, where: string): ReviewCopyBlock {
	return { kind: 'missing', text: `[MISSING: ${what} — ${why}. See ${checklistFile}, ${where}.]` };
}

const sectionsNote = `"${CHECKLIST_NOTE.sections}"`;
const figuresNote = `"${CHECKLIST_NOTE.figures}"`;
const noSection = `no such section in ${DRAFTING_FILE_NAMES.draft}`;
const noFigures = `no figures in ${DRAFTING_FILE_NAMES.figures}`;

function toBlock(paragraph: FilingParagraph): ReviewCopyBlock {
	return paragraph.kind === 'heading' ? heading(paragraph.level ?? 1, paragraph.text) : text(paragraph.text);
}

/** Composes the blocks of the full review copy. */
export function composeFullReviewCopy(input: FullReviewCopyInput): ReviewCopyBlock[] {
	const { office, manifest } = input;
	const ordered = orderSections(exportedParagraphs(input.draft), office);
	const { figures, drawnParts } = parseFigureSections(input.figures ?? '');
	const ofType = (type: ReturnType<typeof documentTypeOf>) => ordered.filter(paragraph => documentTypeOf(paragraph) === type);
	const abstractText = ofType('abstract').filter(paragraph => paragraph.kind === 'text').flatMap(filingParagraphs).map(toBlock);
	const abstract = abstractText.length ? abstractText : [missing('Abstract', noSection, sectionsNote)];
	const claims = ofType('claims').flatMap(filingParagraphs);
	const blocks: ReviewCopyBlock[] = [];

	// 1. Front page.
	blocks.push(
		text(`**${REVIEW_COPY_MARK}**`),
		manifest.title ? heading(1, manifest.title) : missing('Title', `no title heading in ${DRAFTING_FILE_NAMES.draft}`, sectionsNote),
		text(`Office: ${office}`),
		text('Applicant: ______________________'),
		text('Inventor(s): ______________________'),
		heading(2, 'Abstract'),
		...abstract,
		text(manifest.abstractFigure ? `[Abstract figure: ${manifest.abstractFigure}, proposed]` : '[Abstract figure: none, no figures]'),
		pageBreak,
	);

	// 2. Description, each missing required section in its place, text paragraphs numbered.
	blocks.push(heading(1, 'Description'));
	const absent = missingSections(input.draft, office, figures.length > 0).map(section => ({ section, rank: OFFICE_SECTIONS[office].indexOf(section) }));
	const placeholdersBefore = (rank: number) => {
		while (absent.length && absent[0].rank < rank) {
			const { section } = absent[0];
			absent.shift();
			blocks.push(heading(2, section.name), missing(section.name, noSection, sectionsNote));
		}
	};
	let number = 0;
	for (const paragraph of ofType('description')) {
		if (paragraph.kind === 'heading') {
			if (paragraph.section === manifest.title && /^#\s/.test(paragraph.text)) {
				continue;
			}
			const rank = sectionRank(paragraph, office);
			if (rank !== undefined) {
				placeholdersBefore(rank);
			}
		}
		for (const filing of filingParagraphs(paragraph)) {
			blocks.push(filing.kind === 'heading' ? toBlock(filing) : text(`[${String(++number).padStart(4, '0')}] ${filing.text}`));
		}
	}
	placeholdersBefore(Infinity);
	blocks.push(pageBreak);

	// 3. Claims.
	blocks.push(...(claims.some(paragraph => paragraph.kind === 'text') ? claims.map(toBlock) : [heading(1, 'Claims'), missing('Claims', noSection, sectionsNote)]));
	blocks.push(pageBreak);

	// 4. Abstract.
	blocks.push(heading(1, 'Abstract'), ...abstract);

	// 5. Drawings, one page per figure.
	if (!figures.length) {
		blocks.push(pageBreak, heading(1, 'Drawings'), missing('Drawings', noFigures, figuresNote));
	}
	for (const figure of figures) {
		blocks.push(pageBreak, heading(1, figure.label), ...figure.parts.map(part => text(`${part.numeral} — ${part.part}`)), text('[Drawing sheet to be supplied]'));
	}

	// 6. EPO: the list of reference signs of the parts shown in the figures.
	if (office === 'EPO') {
		const signs = drawnParts.filter((part, index) => drawnParts.findIndex(other => other.numeral === part.numeral) === index)
			.sort((a, b) => parseInt(a.numeral, 10) - parseInt(b.numeral, 10) || a.numeral.localeCompare(b.numeral));
		blocks.push(pageBreak, heading(1, 'Reference signs list'), ...(signs.length ? signs.map(part => text(`${part.numeral} ${part.part}`)) : [missing('Reference signs', `no parts under a figure in ${DRAFTING_FILE_NAMES.figures}`, figuresNote)]));
	}
	return blocks;
}
