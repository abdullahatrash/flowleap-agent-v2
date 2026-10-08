/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { OFFICE_PAGE_SETUP } from '../drafting/filingDocuments';
import { checkPageCount, estimatePages, filingManifest, pageEstimateBasis } from '../drafting/filingManifest';

const claims = `---
approved: true
---
1. A hinge comprising a housing and a lever.
2. The hinge of claim 1, wherein the lever is steel.
3. A method of mounting a door, comprising fixing a hinge to a frame.
4. The method of claim 3, wherein the frame is wood.
`;

const figures = `## FIG. 1

- 12: housing
- 14: lever

## FIG. 2

- 16: frame
- 18: door
`;

const draft = (frontmatter: string, description: string) => `---
office: EPO
${frontmatter}---
# Door hinge

## Technical field

<!-- src: template -->
${description}

## Claims

1. A hinge comprising a housing and a lever.
2. The hinge of claim 1, wherein the lever is steel.

## Abstract

<!-- src: feature:F1 -->
A door (18) hangs on a frame (16) by a hinge with a housing (12).

## Inventor Questions

> **Inventor Question IQ-1:** Which steel grade is the lever made of?
`;

/** A paragraph of exactly `length` characters. */
const paragraph = (length: number) => 'x'.repeat(length);

describe('filing manifest page estimate', () => {

	it('derives characters per line and lines per page from the office page setup', () => {
		expect({ EPO: pageEstimateBasis(OFFICE_PAGE_SETUP.EPO), US: pageEstimateBasis(OFFICE_PAGE_SETUP.US) }).toEqual({
			// A4: 165 mm text width, 257 mm text height less the page-number line; 12 pt at 1.5 spacing.
			EPO: { charactersPerLine: 77, linesPerPage: 39 },
			// Letter: 170.9 mm text width, 239.4 mm text height less the page-number line.
			US: { charactersPerLine: 80, linesPerPage: 36 },
		});
	});

	it('counts the lines of each paragraph and one line between paragraphs, rounded up to whole pages', () => {
		const text = (count: number, length: number) => Array.from({ length: count }, () => ({ kind: 'text' as const, text: paragraph(length) }));
		expect({
			empty: estimatePages([], OFFICE_PAGE_SETUP.EPO),
			oneLine: estimatePages(text(1, 10), OFFICE_PAGE_SETUP.EPO),
			// 13 paragraphs of 2 lines plus a gap each = 39 lines: one full A4 page.
			fullPage: estimatePages(text(13, 154), OFFICE_PAGE_SETUP.EPO),
			overflow: estimatePages(text(13, 155), OFFICE_PAGE_SETUP.EPO),
			// 100 paragraphs of 400 characters: EPO 6 + 1 lines each, US 5 + 1.
			longEpo: estimatePages(text(100, 400), OFFICE_PAGE_SETUP.EPO),
			longUs: estimatePages(text(100, 400), OFFICE_PAGE_SETUP.US),
			boldMarksNotCounted: estimatePages([{ kind: 'text', text: `**${paragraph(77)}**` }], OFFICE_PAGE_SETUP.EPO),
		}).toEqual({ empty: 0, oneLine: 1, fullPage: 1, overflow: 2, longEpo: 18, longUs: 17, boldMarksNotCounted: 1 });
	});
});

describe('filingManifest', () => {

	it('reads title, language, claims, drawing sheets, the proposed abstract figure and estimated pages from the draft files', () => {
		expect(filingManifest({ office: 'EPO', draft: draft('language: English\n', 'A hinge joins a door to a frame.'), claims, figures })).toEqual({
			office: 'EPO',
			title: 'Door hinge',
			language: 'English',
			claims: { total: 4, independent: 2 },
			figures: ['FIG. 1', 'FIG. 2'],
			drawingSheets: 2,
			drawingSheetsDeclared: false,
			abstractFigure: 'FIG. 2',
			pages: { description: 1, claims: 1, abstract: 1, drawings: 2, total: 5 },
		});
	});

	it('takes the title from the frontmatter and the drawing sheets from figures.md when set; no language, no figures', () => {
		const manifest = filingManifest({ office: 'US', draft: draft('title: Hinge for heavy doors\n', 'A hinge.'), claims, figures: '---\ndrawingSheets: 1\n---\n' });
		expect({ title: manifest.title, language: manifest.language, figures: manifest.figures, drawingSheets: manifest.drawingSheets, drawingSheetsDeclared: manifest.drawingSheetsDeclared, abstractFigure: manifest.abstractFigure }).toEqual({
			title: 'Hinge for heavy doors', language: undefined, figures: [], drawingSheets: 1, drawingSheetsDeclared: true, abstractFigure: undefined,
		});
	});
});

describe('checkPageCount', () => {

	const longDescription = Array.from({ length: 34 * 13 }, () => paragraph(154)).join('\n\n<!-- src: template -->\n');

	it('adds a Note when an EPO application has more than 35 pages (estimated), drawings counted', () => {
		const manifest = filingManifest({ office: 'EPO', draft: draft('', longDescription), claims, figures });
		expect({ pages: manifest.pages, findings: checkPageCount(manifest) }).toEqual({
			pages: { description: 35, claims: 1, abstract: 1, drawings: 2, total: 39 },
			findings: [{
				severity: 'Note',
				rule: 'page-count',
				file: 'filing-manifest.md',
				message: 'About 39 pages (estimated: description 35, claims 1, abstract 1, drawings 2): the EPO page fee is due for each page over 35 (RFees Art. 2(1) item 1a). The count is an estimate from the text; check the page count in Word before filing.',
			}],
		});
	});

	it('adds no Note at 35 pages or fewer, and none for the US', () => {
		expect([
			checkPageCount(filingManifest({ office: 'EPO', draft: draft('', 'A hinge.'), claims, figures })),
			checkPageCount(filingManifest({ office: 'US', draft: draft('', longDescription), claims, figures })),
		]).toEqual([[], []]);
	});
});
