/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { OFFICE_PAGE_SETUP } from '../drafting/filingDocuments';
import { checkPageCount, estimatePages, filingManifest, pageEstimateBasis, renderFilingManifest } from '../drafting/filingManifest';
import { resolveDraftingFolder } from '../drafting/folderContract';

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
			figureCount: 2,
			drawingSheets: 2,
			drawingSheetsDeclared: false,
			abstractFigure: 'FIG. 2',
			abstractFigureBasis: 'numerals',
			pages: { description: 1, claims: 1, abstract: 1, drawings: 2, total: 5 },
			pagesForPageFee: 5,
		});
	});

	it('takes the title from the frontmatter and the drawing sheets from figures.md when set; no language, no figures', () => {
		const manifest = filingManifest({ office: 'US', draft: draft('title: Hinge for heavy doors\n', 'A hinge.'), claims, figures: '---\ndrawingSheets: 1\n---\n' });
		expect({ title: manifest.title, language: manifest.language, figures: manifest.figures, drawingSheets: manifest.drawingSheets, drawingSheetsDeclared: manifest.drawingSheetsDeclared, abstractFigure: manifest.abstractFigure }).toEqual({
			title: 'Hinge for heavy doors', language: undefined, figures: [], drawingSheets: 1, drawingSheetsDeclared: true, abstractFigure: undefined,
		});
	});
});

/** The headings of figures.md in the IDF-005 live test (2026-10-08). */
const idf005Figures = `# Figures

## FIG. 1

- 10: bicycle frame

## FIG. 2

- 12: quick-release lever

## FIG. 3

## FIG. 4

## FIG. 5

## FIG. 6

## FIGS. 7 to 10

- 14: cam

## Parts named in the answers, figure not stated

- 16: spring
`;

describe('filingManifest figures', () => {

	it('counts only figure headings: a range counts each figure, other headings are no figure, and the sheets are an estimate', () => {
		const manifest = filingManifest({ office: 'EPO', draft: draft('', 'A hinge.').replace('A door (18) hangs on a frame (16) by a hinge with a housing (12).', 'A hinge with a spring (16).'), claims, figures: idf005Figures });
		const rendered = renderFilingManifest(manifest, resolveDraftingFolder('idf-005')!).split('\n').filter(line => /^\| (?:Drawing sheets|Figures|Abstract figure) /.test(line));
		expect({ figures: manifest.figures, figureCount: manifest.figureCount, drawingSheets: manifest.drawingSheets, abstractFigure: manifest.abstractFigure, rendered }).toEqual({
			figures: ['FIG. 1', 'FIG. 2', 'FIG. 3', 'FIG. 4', 'FIG. 5', 'FIG. 6', 'FIGS. 7 to 10'],
			figureCount: 10,
			drawingSheets: 10,
			abstractFigure: 'FIG. 1',
			rendered: [
				'| Drawing sheets | 10 (estimated: one sheet per figure in figures.md; set `drawingSheets` in its frontmatter to the real count) |',
				'| Figures | 10: FIG. 1, FIG. 2, FIG. 3, FIG. 4, FIG. 5, FIG. 6, FIGS. 7 to 10 |',
				'| Abstract figure | FIG. 1 (proposed: the first figure, because the abstract names no reference numeral of any figure; the attorney confirms it) |',
			],
		});
	});

	it('proposes a range heading as one entry, as written, when the abstract names its numerals', () => {
		const manifest = filingManifest({ office: 'EPO', draft: draft('', 'A hinge.').replace('A door (18) hangs on a frame (16) by a hinge with a housing (12).', 'A lever with a cam (14).'), claims, figures: idf005Figures });
		expect({ abstractFigure: manifest.abstractFigure, basis: manifest.abstractFigureBasis }).toEqual({ abstractFigure: 'FIGS. 7 to 10', basis: 'numerals' });
	});
});

describe('renderFilingManifest', () => {

	it('EPO: states the pages counted for the page fee, the abstract as one page; the US manifest has no such line', () => {
		const pagesSection = (office: 'EPO' | 'US') => {
			const rendered = renderFilingManifest(filingManifest({ office, draft: draft('', 'A hinge.'), claims, figures }), resolveDraftingFolder('hinge')!);
			return rendered.slice(rendered.indexOf('| Document |')).trim().split('\n');
		};
		expect({ EPO: pagesSection('EPO'), US: pagesSection('US') }).toEqual({
			EPO: [
				'| Document | File | Pages |',
				'| --- | --- | --- |',
				'| Description | draft-application.description.docx | 1 |',
				'| Claims | draft-application.claims.docx | 1 |',
				'| Abstract | draft-application.abstract.docx | 1 |',
				'| Drawings | Not generated: prepared outside FlowLeap | 2 |',
				'| Total | | 5 |',
				'',
				'Pages counted for the page fee: 5 (the abstract counts as one page, Rule 38(3) EPC; the EPO page fee is due for each page over 35, RFees Art. 2(1) item 1a).',
			],
			US: [
				'| Document | File | Pages |',
				'| --- | --- | --- |',
				'| Description | draft-application.description.docx | 1 |',
				'| Claims | draft-application.claims.docx | 1 |',
				'| Abstract | draft-application.abstract.docx | 1 |',
				'| Drawings | Not generated: prepared outside FlowLeap | 2 |',
				'| Total | | 5 |',
			],
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
				file: 'draft-application.md',
				message: 'About 39 pages count for the page fee (estimated from the draft text: description 35, claims 1, abstract 1, drawings 2): the EPO page fee is due for each page over 35 (Rule 38(3) EPC; RFees Art. 2(1) item 1a). Check the page count in Word before filing.',
			}],
		});
	});

	it('counts the abstract as one page for the page fee (Rule 38(3) EPC), whatever its estimated pages', () => {
		const description = Array.from({ length: 30 * 13 }, () => paragraph(154)).join('\n\n<!-- src: template -->\n');
		const longAbstract = draft('', description).replace('A door (18) hangs on a frame (16) by a hinge with a housing (12).', paragraph(40 * 77));
		const manifest = filingManifest({ office: 'EPO', draft: longAbstract, claims, figures });
		expect({ pages: manifest.pages, pagesForPageFee: manifest.pagesForPageFee, findings: checkPageCount(manifest) }).toEqual({
			pages: { description: 31, claims: 1, abstract: 2, drawings: 2, total: 36 },
			pagesForPageFee: 35,
			findings: [],
		});
	});

	it('adds no Note at 35 pages or fewer, and none for the US', () => {
		expect([
			checkPageCount(filingManifest({ office: 'EPO', draft: draft('', 'A hinge.'), claims, figures })),
			checkPageCount(filingManifest({ office: 'US', draft: draft('', longDescription), claims, figures })),
		]).toEqual([[], []]);
	});
});
