/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import JSZip from 'jszip';
import * as mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import { filingManifest } from '../../common/drafting/filingManifest';
import { composeFullReviewCopy } from '../../common/drafting/fullReviewCopy';
import { buildDraftDocx, buildFullReviewCopyDocx } from '../draftDocx';

/** A draft of the given section headings, each with one marked paragraph naming its section. */
function draft(...headings: string[]): string {
	return headings.map(heading => `${heading}\n\n<!-- src: template -->\nText of ${heading.replace(/^#+\s*/, '')}.`).join('\n\n');
}

/** The paragraphs of the description, claims and abstract files, in that order. */
async function docxLines(text: string, office: 'US' | 'EPO'): Promise<string[]> {
	const documents = await buildDraftDocx(text, office);
	const lines: string[] = [];
	for (const docx of [documents.description, documents.claims, documents.abstract]) {
		lines.push(...(await mammoth.extractRawText({ buffer: Buffer.from(docx) })).value.split('\n').filter(Boolean));
	}
	return lines;
}

/** The attributes of the first `<w:name ...>` element of an XML part, without the `w:` prefix. */
function attributes(xml: string, name: string): Record<string, string> | undefined {
	const element = new RegExp(`<w:${name}\\b(?<attributes>[^>]*?)/?>`).exec(xml);
	if (!element?.groups) {
		return undefined;
	}
	return Object.fromEntries([...element.groups.attributes.matchAll(/w:(?<key>\w+)="(?<value>[^"]*)"/g)].map(match => [match.groups!.key, match.groups!.value]));
}

/**
 * The page setup Word reads from one .docx: the section properties (page size, margins, line
 * numbering), the default line spacing, and where the centred page number field is.
 */
async function pageSetup(docx: Uint8Array) {
	const zip = await JSZip.loadAsync(docx);
	const part = async (path: string) => await zip.file(path)?.async('string') ?? '';
	const sectionProperties = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(await part('word/document.xml'))?.[0] ?? '';
	const pageNumber = async (kind: 'header' | 'footer') => {
		for (const file of Object.keys(zip.files).filter(path => new RegExp(`^word/${kind}\\d+\\.xml$`).test(path))) {
			const xml = await part(file);
			if (/\bPAGE\b/.test(xml)) {
				return `${kind}, ${attributes(xml, 'jc')?.val}`;
			}
		}
		return undefined;
	};
	return {
		size: attributes(sectionProperties, 'pgSz'),
		margins: attributes(sectionProperties, 'pgMar'),
		lineNumbers: attributes(sectionProperties, 'lnNumType'),
		lineSpacing: attributes(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(await part('word/styles.xml'))?.[0] ?? '', 'spacing'),
		pageNumber: await pageNumber('header') ?? await pageNumber('footer'),
	};
}

describe('buildDraftDocx section order', () => {

	it('US: orders the sections as 37 CFR 1.77(b), keeps an unknown section after the one it followed, Claims and Abstract last', async () => {
		expect(await docxLines(draft('# Hinge', '## DETAILED DESCRIPTION', '## Custom Notes', '## BACKGROUND', '## SUMMARY', '## ABSTRACT', '## CLAIMS', '## CROSS-REFERENCE TO RELATED APPLICATIONS', '## BRIEF DESCRIPTION OF THE DRAWINGS', '## Inventor Questions'), 'US')).toEqual([
			'Hinge', 'Text of Hinge.',
			'CROSS-REFERENCE TO RELATED APPLICATIONS', 'Text of CROSS-REFERENCE TO RELATED APPLICATIONS.',
			'BACKGROUND', 'Text of BACKGROUND.',
			'SUMMARY', 'Text of SUMMARY.',
			'BRIEF DESCRIPTION OF THE DRAWINGS', 'Text of BRIEF DESCRIPTION OF THE DRAWINGS.',
			'DETAILED DESCRIPTION', 'Text of DETAILED DESCRIPTION.',
			'Custom Notes', 'Text of Custom Notes.',
			'CLAIMS', 'Text of CLAIMS.',
			'ABSTRACT', 'Text of ABSTRACT.',
		]);
	});

	it('EPO: orders the sections as Rule 42(1) EPC, sub-sections moving with their section', async () => {
		expect(await docxLines(draft('# Hinge', '## Summary of the invention', '## Technical field', '## Industrial application', '## Background art', '## Detailed description of embodiments', '### First embodiment', '## Brief description of the drawings', '## Abstract', '## Claims'), 'EPO')).toEqual([
			'Hinge', 'Text of Hinge.',
			'Technical field', 'Text of Technical field.',
			'Background art', 'Text of Background art.',
			'Summary of the invention', 'Text of Summary of the invention.',
			'Brief description of the drawings', 'Text of Brief description of the drawings.',
			'Detailed description of embodiments', 'Text of Detailed description of embodiments.',
			'First embodiment', 'Text of First embodiment.',
			'Industrial application', 'Text of Industrial application.',
			'Claims', 'Text of Claims.',
			'Abstract', 'Text of Abstract.',
		]);
	});
});

describe('buildDraftDocx page setup', () => {

	const text = draft('# Hinge', '## Background', '## Claims', '## Abstract');
	/** 2 cm and 2.5 cm in twentieths of a point. */
	const cm2 = '1134', cm25 = '1417';
	/** 1.5 line spacing, and one 1.5 line between paragraphs. */
	const lineSpacing = { line: '360', after: '360' };

	it('EPO: Rule 49 EPC in every file, A4, page number centred at the top below the top margin, line numbers every five lines in the description and the claims', async () => {
		const documents = await buildDraftDocx(text, 'EPO');
		const a4 = { size: { w: '11906', h: '16838', orient: 'portrait' }, margins: { top: cm2, right: cm2, bottom: cm2, left: cm25, header: cm2, footer: cm2, gutter: '0' }, lineSpacing, pageNumber: 'header, center' };
		const lineNumbers = { countBy: '5', restart: 'newPage' };
		expect({
			description: await pageSetup(documents.description),
			claims: await pageSetup(documents.claims),
			abstract: await pageSetup(documents.abstract),
		}).toEqual({
			description: { ...a4, lineNumbers },
			claims: { ...a4, lineNumbers },
			abstract: { ...a4, lineNumbers: undefined },
		});
	});

	it('US: 37 CFR 1.52 in every file, letter size, page number centred at the bottom, no line numbers', async () => {
		const documents = await buildDraftDocx(text, 'US');
		const letter = { size: { w: '12240', h: '15840', orient: 'portrait' }, margins: { top: cm2, right: cm2, bottom: cm2, left: cm25, header: cm2, footer: cm2, gutter: '0' }, lineSpacing, pageNumber: 'footer, center', lineNumbers: undefined };
		expect({
			description: await pageSetup(documents.description),
			claims: await pageSetup(documents.claims),
			abstract: await pageSetup(documents.abstract),
		}).toEqual({ description: letter, claims: letter, abstract: letter });
	});
});

describe('buildFullReviewCopyDocx', () => {
	const claims = '---\napproved: true\n---\n1. A hinge comprising a housing 12.\n2. The hinge of claim 1, wherein the housing is steel.\n';
	const figures = '# Figures\n\n## FIG. 1\n\n- 12: housing\n- 14: lever\n\n## FIGS. 2 to 3\n\n- 16: frame\n\n## Parts named in the answers, figure not stated\n\n- 18: spring\n';
	const text = (office: 'US' | 'EPO') => `---\noffice: ${office}\n---\n# Door hinge\n\n${draft('## Detailed Description', '## Background', '## Summary').replace('Text of Detailed Description.', 'The housing 12 holds the lever 14.\n\n<!-- src: template -->\nThe lever 14 pivots.')}\n\n## Claims\n\n1. A hinge comprising a housing 12.\n2. The hinge of claim 1, wherein the housing is steel.\n\n## Abstract\n\n<!-- src: feature:F1 -->\nA hinge with a housing (12).\n`;

	/** The paragraphs of the full review copy as Word reads them, and the text of its headers. */
	async function readBack(office: 'US' | 'EPO', withFigures = true) {
		const draftText = text(office);
		const manifest = filingManifest({ office, draft: draftText, claims, figures: withFigures ? figures : undefined });
		const docx = await buildFullReviewCopyDocx(composeFullReviewCopy({ office, draft: draftText, figures: withFigures ? figures : undefined, manifest }), office);
		const zip = await JSZip.loadAsync(docx);
		const headers = await Promise.all(Object.keys(zip.files).filter(path => /^word\/header\d+\.xml$/.test(path)).map(async path => (await zip.file(path)!.async('string')).replace(/<[^>]+>/g, '')));
		return {
			lines: (await mammoth.extractRawText({ buffer: Buffer.from(docx) })).value.split('\n').filter(Boolean),
			pageBreaks: ((await zip.file('word/document.xml')!.async('string')).match(/<w:pageBreakBefore\/>/g) ?? []).length,
			markInHeader: headers.some(header => header.includes('Draft for attorney review — not for filing')),
		};
	}

	it('EPO: front page, description in Rule 42 order with [0001] numbering and missing sections naming the checklist note, claims, abstract, one drawings page per figure, reference signs of the drawn parts only', async () => {
		expect(await readBack('EPO')).toEqual({
			lines: [
				'Draft for attorney review — not for filing',
				'Door hinge',
				'Office: EPO',
				'Applicant: ______________________',
				'Inventor(s): ______________________',
				'Abstract',
				'A hinge with a housing (12).',
				'[Abstract figure: FIG. 1, proposed]',
				'Description',
				'Technical Field',
				'[MISSING: Technical Field — no such section in draft-application.md. See checklist.md, "Required sections".]',
				'Background',
				'[0001] Text of Background.',
				'Summary',
				'[0002] Text of Summary.',
				'Brief Description of the Drawings',
				'[MISSING: Brief Description of the Drawings — no such section in draft-application.md. See checklist.md, "Required sections".]',
				'Detailed Description',
				'[0003] The housing 12 holds the lever 14.',
				'[0004] The lever 14 pivots.',
				'Claims',
				'1. A hinge comprising a housing 12.',
				'2. The hinge of claim 1, wherein the housing is steel.',
				'Abstract',
				'A hinge with a housing (12).',
				'FIG. 1',
				'12 — housing',
				'14 — lever',
				'[Drawing sheet to be supplied]',
				'FIGS. 2 to 3',
				'16 — frame',
				'[Drawing sheet to be supplied]',
				'Reference signs list',
				'12 housing',
				'14 lever',
				'16 frame',
			],
			pageBreaks: 6,
			markInHeader: true,
		});
	});

	it('US: no reference signs list; without figures the drawings are missing, naming the checklist note "Figures"; no drawings section is due', async () => {
		const { lines } = await readBack('US', false);
		expect(lines.filter(line => line.startsWith('[MISSING') || line.startsWith('[Abstract figure') || /^(?:Drawings|Reference signs list)$/.test(line))).toEqual([
			'[Abstract figure: none, no figures]',
			'Drawings',
			'[MISSING: Drawings — no figures in figures.md. See checklist.md, "Figures".]',
		]);
	});
});
