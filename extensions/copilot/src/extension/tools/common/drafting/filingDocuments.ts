/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The filing documents of a Draft Application export: the page setup of each office and the
 * paragraphs of each document type (description, claims, abstract). The .docx export and the
 * filing manifest read the same paragraphs, so the page estimate counts what the export writes.
 */

import { INVENTOR_QUESTION } from './finding';
import { DraftDocumentType } from './folderContract';
import { DraftingOffice } from './frontmatter';
import { DraftParagraph, parseDraftParagraphs, stripSourceMarkers } from './sourceMarkers';
import { isAbstractParagraph, isClaimsParagraph } from './specValidators';

/** A length in millimetres. */
type Millimetres = number;

/** The page setup of the filing documents of one office. */
export interface OfficePageSetup {
	/** The rule the setup implements. */
	readonly rule: string;
	readonly paper: 'A4' | 'Letter';
	readonly width: Millimetres;
	readonly height: Millimetres;
	readonly margins: { readonly top: Millimetres; readonly left: Millimetres; readonly right: Millimetres; readonly bottom: Millimetres };
	/** The line spacing as a multiple of a single line. */
	readonly lineSpacing: number;
	/** The font size of the body text in points. */
	readonly fontSize: number;
	/** Where the page number is, centred: in the header or in the footer. */
	readonly pageNumbers: 'top' | 'bottom';
	/** The document types whose lines are numbered, and the step of the numbers. */
	readonly lineNumbers?: { readonly every: number; readonly documents: readonly DraftDocumentType[] };
}

/**
 * The page setup of each office:
 *
 * - EPO, Rule 49 EPC: A4; margins top 2 cm, left 2.5 cm, right 2 cm, bottom 2 cm; 1.5 line
 *   spacing; pages numbered centred at the top, not in the top margin; the lines of the
 *   description and the claims numbered in sets of five.
 * - US, 37 CFR 1.52: letter size (A4 is also allowed); the same minimum margins; 1.5 line
 *   spacing; pages numbered centred, preferably below the text.
 */
export const OFFICE_PAGE_SETUP: Readonly<Record<DraftingOffice, OfficePageSetup>> = {
	EPO: {
		rule: 'Rule 49 EPC',
		paper: 'A4',
		width: 210,
		height: 297,
		margins: { top: 20, left: 25, right: 20, bottom: 20 },
		lineSpacing: 1.5,
		fontSize: 12,
		pageNumbers: 'top',
		lineNumbers: { every: 5, documents: ['description', 'claims'] },
	},
	US: {
		rule: '37 CFR 1.52',
		paper: 'Letter',
		width: 215.9,
		height: 279.4,
		margins: { top: 20, left: 25, right: 20, bottom: 20 },
		lineSpacing: 1.5,
		fontSize: 12,
		pageNumbers: 'bottom',
	},
};

/** One paragraph of an exported document, as plain text. */
export interface FilingParagraph {
	readonly kind: 'heading' | 'text';
	/** The heading level (1 for `#`), for a heading. */
	readonly level?: number;
	/** The text, `**bold**` spans kept, joined to one line. */
	readonly text: string;
}

const claimStart = /^\s*\d+\s*[.)]\s+/;

/**
 * The paragraphs the export writes: source markers stripped, frontmatter, Inventor Question
 * blocks and the `Inventor Questions` section left out.
 */
export function exportedParagraphs(draft: string): DraftParagraph[] {
	return parseDraftParagraphs(stripSourceMarkers(draft))
		.filter(paragraph => paragraph.kind !== INVENTOR_QUESTION && !/^inventor questions?$/i.test(paragraph.section ?? ''));
}

/** The document type a paragraph of the draft goes to. */
export function documentTypeOf(paragraph: DraftParagraph): DraftDocumentType {
	if (isClaimsParagraph(paragraph)) {
		return 'claims';
	}
	return isAbstractParagraph(paragraph) ? 'abstract' : 'description';
}

/** The heading level of a heading paragraph (1 for `#`). */
export function headingLevel(paragraph: DraftParagraph): number {
	return /^(?<hashes>#+)/.exec(paragraph.text)?.groups?.hashes.length ?? 1;
}

/**
 * The paragraphs of one exported paragraph of the draft: a heading as its title, a claims text
 * as one paragraph per numbered claim, any other text joined to one line.
 */
export function filingParagraphs(paragraph: DraftParagraph): FilingParagraph[] {
	if (paragraph.kind === 'heading') {
		return [{ kind: 'heading', level: headingLevel(paragraph), text: paragraph.section ?? '' }];
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
		return claims.map(text => ({ kind: 'text', text }));
	}
	return [{ kind: 'text', text: paragraph.text.split('\n').map(line => line.trim()).filter(Boolean).join(' ') }];
}

/**
 * The paragraphs of each filing document, in the order given: each paragraph of the draft goes to
 * its document type ({@link documentTypeOf}) as its filing paragraphs ({@link filingParagraphs}).
 */
export function documentParagraphs(paragraphs: readonly DraftParagraph[]): Record<DraftDocumentType, FilingParagraph[]> {
	const documents: Record<DraftDocumentType, FilingParagraph[]> = { description: [], claims: [], abstract: [] };
	for (const paragraph of paragraphs) {
		documents[documentTypeOf(paragraph)].push(...filingParagraphs(paragraph));
	}
	return documents;
}

/** One top-level section of the office section order. */
export interface OfficeSection {
	/** Matches the lower-case heading text. */
	readonly pattern: RegExp;
	/** The section name the full review copy writes when the section is missing. */
	readonly name: string;
	readonly required?: boolean;
	/** True for the section that describes the drawings: it is due only when figures.md has figures. */
	readonly drawings?: boolean;
}

/**
 * The recognised top-level sections of each office, in filing order: US 37 CFR 1.77(b) and EPO
 * Rule 42(1) EPC, as the application-drafting skill references list them. Claims and Abstract
 * are always last (see {@link sectionRank}). A `required` section is one the full review copy
 * shows as missing when the draft has none.
 */
export const OFFICE_SECTIONS: Readonly<Record<DraftingOffice, readonly OfficeSection[]>> = {
	US: [
		{ pattern: /cross[- ]?reference/, name: 'Cross-Reference to Related Applications' },
		{ pattern: /federally sponsored|government (?:interest|rights|support)/, name: 'Statement Regarding Federally Sponsored Research' },
		{ pattern: /joint research/, name: 'Names of the Parties to a Joint Research Agreement' },
		{ pattern: /sequence listing|program listing|table appendix/, name: 'Sequence Listing' },
		{ pattern: /prior disclosures?/, name: 'Statement Regarding Prior Disclosures' },
		{ pattern: /\bfield\b/, name: 'Field' },
		{ pattern: /background/, name: 'Background', required: true },
		{ pattern: /summary/, name: 'Summary', required: true },
		{ pattern: /brief description|drawings/, name: 'Brief Description of the Drawings', required: true, drawings: true },
		{ pattern: /detailed description|description of (?:the )?(?:preferred )?embodiments?/, name: 'Detailed Description', required: true },
	],
	EPO: [
		{ pattern: /\bfield\b/, name: 'Technical Field', required: true },
		{ pattern: /background|prior art/, name: 'Background Art', required: true },
		{ pattern: /summary|disclosure of the invention|technical problem|problem and (?:its )?solution/, name: 'Summary of the Invention', required: true },
		{ pattern: /brief description|drawings/, name: 'Brief Description of the Drawings', required: true, drawings: true },
		{ pattern: /detailed description|embodiments?|carrying out/, name: 'Description of Embodiments', required: true },
		{ pattern: /industrial applica/, name: 'Industrial Applicability' },
	],
};

/** The rank of the Claims and of the Abstract: after every description section. */
export const CLAIMS_RANK = 1000;
const ABSTRACT_RANK = 1001;

/** The filing position of a section heading for the office, or `undefined` when it is not recognised. */
export function sectionRank(heading: DraftParagraph, office: DraftingOffice): number | undefined {
	if (isClaimsParagraph(heading)) {
		return CLAIMS_RANK;
	}
	if (isAbstractParagraph(heading)) {
		return ABSTRACT_RANK;
	}
	const title = (heading.section ?? '').toLowerCase();
	const index = OFFICE_SECTIONS[office].findIndex(section => section.pattern.test(title));
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
export function orderSections(paragraphs: readonly DraftParagraph[], office: DraftingOffice): DraftParagraph[] {
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
