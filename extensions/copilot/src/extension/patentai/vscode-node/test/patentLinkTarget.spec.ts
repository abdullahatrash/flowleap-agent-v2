/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { PATENT_LINK_URI_PATTERN, parsePublicationNumber, recognizePatentLink } from '../../common/patentLinkTarget';
import { buildLoadingPatentPill, buildPatentPill, buildUnenrichedPatentPill, PATENT_LINK_PRESENTATION_PROVIDER_ID, readPatentPillFacts } from '../patentLinkPresentationProvider';

const rule = new RegExp(PATENT_LINK_URI_PATTERN, 'i');

/** What each link yields: whether the manifest's pattern selects it, and the number it resolves to. */
function read(uri: string): string {
	const target = recognizePatentLink(uri);
	return `${rule.test(uri) ? 'selected' : 'ignored'} ${target ? `${target.publicationNumber} (${target.source})` : 'no target'}`;
}

describe('patent link recognizer', () => {
	it('selects the patent surfaces and resolves each to its publication number', () => {
		const links = [
			'flowleap://flowleap.patent-ai/patent?publication=EP1602570B1&section=claims&claim=1',
			'flowleap://flowleap.patent-ai/patent?section=bibliography&publication=US10958080B2',
			'code-oss://flowleap.patent-ai/patent?publication=WO2020123456A1&section=abstract',
			'https://patents.google.com/patent/US10958080B2/en',
			'https://patents.google.com/patent/EP1602570B1',
			'https://patents.google.com/patent/KR102012345B1/en?oq=battery',
			'https://patents.google.com/patent/CN110123456A/zh',
			'https://patents.google.com/patent/JP6543210B2/ja',
			'https://patents.google.com/patent/DE102004012345A1/de',
			'https://patents.google.com/patent/FR2901234A1/fr',
			'https://worldwide.espacenet.com/patent/search/family/012345/publication/EP1602570B1?q=pi%3D1',
			'https://worldwide.espacenet.com/publicationDetails/biblio?CC=EP&NR=1602570&KC=B1&FT=D',
			'https://worldwide.espacenet.com/publicationDetails/biblio?CC=EP&NR=1602570B1&KC=B1&FT=D',
			'https://ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10958080',
			'https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11234567?requestToken=x',
		];
		expect(Object.fromEntries(links.map(link => [link, read(link)]))).toEqual({
			'flowleap://flowleap.patent-ai/patent?publication=EP1602570B1&section=claims&claim=1': 'selected EP1602570B1 (reader)',
			'flowleap://flowleap.patent-ai/patent?section=bibliography&publication=US10958080B2': 'selected US10958080B2 (reader)',
			'code-oss://flowleap.patent-ai/patent?publication=WO2020123456A1&section=abstract': 'selected WO2020123456A1 (reader)',
			'https://patents.google.com/patent/US10958080B2/en': 'selected US10958080B2 (googlePatents)',
			'https://patents.google.com/patent/EP1602570B1': 'selected EP1602570B1 (googlePatents)',
			'https://patents.google.com/patent/KR102012345B1/en?oq=battery': 'selected KR102012345B1 (googlePatents)',
			'https://patents.google.com/patent/CN110123456A/zh': 'selected CN110123456A (googlePatents)',
			'https://patents.google.com/patent/JP6543210B2/ja': 'selected JP6543210B2 (googlePatents)',
			'https://patents.google.com/patent/DE102004012345A1/de': 'selected DE102004012345A1 (googlePatents)',
			'https://patents.google.com/patent/FR2901234A1/fr': 'selected FR2901234A1 (googlePatents)',
			'https://worldwide.espacenet.com/patent/search/family/012345/publication/EP1602570B1?q=pi%3D1': 'selected EP1602570B1 (espacenet)',
			'https://worldwide.espacenet.com/publicationDetails/biblio?CC=EP&NR=1602570&KC=B1&FT=D': 'selected EP1602570B1 (espacenet)',
			'https://worldwide.espacenet.com/publicationDetails/biblio?CC=EP&NR=1602570B1&KC=B1&FT=D': 'selected EP1602570B1 (espacenet)',
			'https://ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10958080': 'selected US10958080 (uspto)',
			'https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11234567?requestToken=x': 'selected US11234567 (uspto)',
		});
	});

	it('leaves every other link alone, so it keeps rendering as a plain link', () => {
		const links = [
			'https://patents.google.com/?q=PET',
			'https://patents.google.com/patent/notanumber/en',
			'https://example.com/patent/US10958080B2',
			'https://github.com/microsoft/vscode/commit/abc1234',
			'https://worldwide.espacenet.com/patent/search?q=ti%3Dbattery',
			'file:///Users/someone/prior-art.md',
			'flowleap://flowleap.patent-ai/patent?publication=EP',
			'not a uri at all',
		];
		expect(Object.fromEntries(links.map(link => [link, read(link)]))).toEqual({
			'https://patents.google.com/?q=PET': 'ignored no target',
			'https://patents.google.com/patent/notanumber/en': 'ignored no target',
			'https://example.com/patent/US10958080B2': 'ignored no target',
			'https://github.com/microsoft/vscode/commit/abc1234': 'ignored no target',
			'https://worldwide.espacenet.com/patent/search?q=ti%3Dbattery': 'ignored no target',
			'file:///Users/someone/prior-art.md': 'ignored no target',
			'flowleap://flowleap.patent-ai/patent?publication=EP': 'ignored no target',
			'not a uri at all': 'ignored no target',
		});
	});

	it('normalizes the separators offices print and rejects anything that is not a publication number', () => {
		const values = ['EP 1 602 570 B1', 'ep1602570b1', 'KR10-2020-0012345', 'US2024/0123456A1', 'EP1602570', 'US7654321', '1602570', 'EP', 'ABCDEFG', ''];
		expect(Object.fromEntries(values.map(value => [value || '(empty)', parsePublicationNumber(value)]))).toEqual({
			'EP 1 602 570 B1': 'EP1602570B1',
			'ep1602570b1': 'EP1602570B1',
			'KR10-2020-0012345': 'KR1020200012345',
			'US2024/0123456A1': 'US20240123456A1',
			'EP1602570': 'EP1602570',
			'US7654321': 'US7654321',
			'1602570': undefined,
			'EP': undefined,
			'ABCDEFG': undefined,
			'(empty)': undefined,
		});
	});

	it('declares the provider in the extension manifest with this id, kind and pattern', () => {
		const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../package.json', import.meta.url)), 'utf8')) as {
			enabledApiProposals: string[];
			contributes: { linkPresentationProviders: { id: string; kind: string; uriPattern: string }[] };
		};
		// Every pill this provider can publish must carry the kind the manifest declares: the service
		// discards a presentation whose kind differs and shows "Not available" instead. Read off the
		// manifest rather than compared to a literal, so changing either side alone fails here.
		const declaredKind = manifest.contributes.linkPresentationProviders[0]?.kind;
		const pillKinds = [
			buildLoadingPatentPill('EP1602570B1').kind,
			buildUnenrichedPatentPill('EP1602570B1').kind,
			buildPatentPill(readPatentPillFacts('EP1602570B1', {}), 'reader').kind,
		];
		expect({
			proposal: manifest.enabledApiProposals.includes('linkPresentation'),
			providers: manifest.contributes.linkPresentationProviders,
			// 'file' presentations are hard-disabled in the service, so this kind must never become that.
			everyPillMatchesTheDeclaredKind: pillKinds.every(kind => kind === declaredKind && kind !== 'file'),
			// The core rejects a pattern that is not anchored or longer than 1024 characters, and it
			// does so silently: the rule would simply never select the provider.
			anchored: PATENT_LINK_URI_PATTERN.startsWith('^') && PATENT_LINK_URI_PATTERN.endsWith('$'),
			withinLengthLimit: PATENT_LINK_URI_PATTERN.length <= 1024,
		}).toEqual({
			proposal: true,
			providers: [{ id: PATENT_LINK_PRESENTATION_PROVIDER_ID, kind: 'resource', uriPattern: PATENT_LINK_URI_PATTERN }],
			everyPillMatchesTheDeclaredKind: true,
			anchored: true,
			withinLengthLimit: true,
		});
	});
});
