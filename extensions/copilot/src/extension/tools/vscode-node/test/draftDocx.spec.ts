/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import JSZip from 'jszip';
import * as mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import { buildDraftDocx } from '../draftDocx';

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
