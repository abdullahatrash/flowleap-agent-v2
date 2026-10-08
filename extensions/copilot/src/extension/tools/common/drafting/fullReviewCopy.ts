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
 * A missing part is a visible `[MISSING: ...]` placeholder in its place that names the Drafting
 * Checklist step that fills it.
 */

import { CHECKLIST_STEP } from './checklist';
import { documentParagraphs, exportedParagraphs, FilingParagraph, OFFICE_SECTIONS, orderSections, sectionRank } from './filingDocuments';
import { FilingManifest } from './filingManifest';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftingOffice } from './frontmatter';
import { parseFigureParts, parseFigureSections } from './specValidators';

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

function missing(what: string, why: string, step: number): ReviewCopyBlock {
	return { kind: 'missing', text: `[MISSING: ${what} — ${why}. See ${checklistFile} step ${step}.]` };
}

const draftMissing = (what: string) => missing(what, `no such section in ${DRAFTING_FILE_NAMES.draft}`, CHECKLIST_STEP.draft);

function toBlock(paragraph: FilingParagraph): ReviewCopyBlock {
	return paragraph.kind === 'heading' ? { kind: 'heading', level: paragraph.level ?? 1, text: paragraph.text } : { kind: 'text', text: paragraph.text };
}

/** Composes the blocks of the full review copy. */
export function composeFullReviewCopy(input: FullReviewCopyInput): ReviewCopyBlock[] {
	const { office, manifest } = input;
	const ordered = orderSections(exportedParagraphs(input.draft), office);
	const documents = documentParagraphs(ordered);
	const { figures } = parseFigureSections(input.figures ?? '');
	const noFigures = missing('Drawings', `no figures in ${DRAFTING_FILE_NAMES.figures}`, CHECKLIST_STEP.featureList);
	const abstractText = documents.abstract.filter(paragraph => paragraph.kind === 'text').map(toBlock);
	const abstract = abstractText.length ? abstractText : [draftMissing('Abstract')];
	const blocks: ReviewCopyBlock[] = [];

	// 1. Front page.
	blocks.push(
		{ kind: 'text', text: `**${REVIEW_COPY_MARK}**` },
		manifest.title ? { kind: 'heading', level: 1, text: manifest.title } : draftMissing('Title'),
		{ kind: 'text', text: `Office: ${office}` },
		{ kind: 'text', text: 'Applicant: ______________________' },
		{ kind: 'text', text: 'Inventor(s): ______________________' },
		{ kind: 'heading', level: 2, text: 'Abstract' },
		...abstract,
		{ kind: 'text', text: manifest.abstractFigure ? `[Abstract figure: ${manifest.abstractFigure}, proposed]` : '[Abstract figure: none, no figures]' },
		{ kind: 'pageBreak' },
	);

	// 2. Description, with the missing office sections in their place and numbered paragraphs.
	blocks.push({ kind: 'heading', level: 1, text: 'Description' });
	const due = OFFICE_SECTIONS[office].map((section, rank) => ({ section, rank })).filter(({ section }) => section.required);
	const present = new Set(ordered.filter(paragraph => paragraph.kind === 'heading').map(paragraph => sectionRank(paragraph, office)));
	let next = 0;
	const placeholdersBefore = (rank: number) => {
		for (; next < due.length && due[next].rank < rank; next++) {
			const { section } = due[next];
			if (!present.has(due[next].rank)) {
				blocks.push({ kind: 'heading', level: 2, text: section.name }, section.drawings && !figures.length
					? missing(section.name, `no figures in ${DRAFTING_FILE_NAMES.figures}`, CHECKLIST_STEP.featureList)
					: draftMissing(section.name));
			}
		}
	};
	let number = 0;
	for (const paragraph of documents.description) {
		if (paragraph.kind === 'heading' && paragraph.level === 1 && paragraph.text === manifest.title) {
			continue;
		}
		if (paragraph.kind === 'heading') {
			const rank = OFFICE_SECTIONS[office].findIndex(section => section.pattern.test(paragraph.text.toLowerCase()));
			if (rank >= 0) {
				placeholdersBefore(rank);
			}
			blocks.push(toBlock(paragraph));
		} else {
			blocks.push({ kind: 'text', text: `[${String(++number).padStart(4, '0')}] ${paragraph.text}` });
		}
	}
	placeholdersBefore(Infinity);
	blocks.push({ kind: 'pageBreak' });

	// 3. Claims.
	blocks.push(...(documents.claims.some(paragraph => paragraph.kind === 'text') ? documents.claims.map(toBlock) : [{ kind: 'heading', level: 1, text: 'Claims' } as const, draftMissing('Claims')]));
	blocks.push({ kind: 'pageBreak' });

	// 4. Abstract.
	blocks.push({ kind: 'heading', level: 1, text: 'Abstract' }, ...abstract);

	// 5. Drawings, one page per figure.
	if (!figures.length) {
		blocks.push({ kind: 'pageBreak' }, { kind: 'heading', level: 1, text: 'Drawings' }, noFigures);
	}
	for (const figure of figures) {
		blocks.push(
			{ kind: 'pageBreak' },
			{ kind: 'heading', level: 1, text: figure.label },
			...figure.parts.map(part => ({ kind: 'text' as const, text: `${part.numeral} — ${part.part}` })),
			{ kind: 'text', text: '[Drawing sheet to be supplied]' },
		);
	}

	// 6. EPO: the list of reference signs.
	if (office === 'EPO') {
		const parts = parseFigureParts(input.figures ?? '');
		const signs = parts.filter((part, index) => parts.findIndex(other => other.numeral === part.numeral) === index)
			.sort((a, b) => parseInt(a.numeral, 10) - parseInt(b.numeral, 10) || a.numeral.localeCompare(b.numeral));
		blocks.push(
			{ kind: 'pageBreak' },
			{ kind: 'heading', level: 1, text: 'Reference signs list' },
			...(signs.length ? signs.map(part => ({ kind: 'text' as const, text: `${part.numeral} ${part.part}` })) : [missing('Reference signs', `no parts in ${DRAFTING_FILE_NAMES.figures}`, CHECKLIST_STEP.featureList)]),
		);
	}
	return blocks;
}
