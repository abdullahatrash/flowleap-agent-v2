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
