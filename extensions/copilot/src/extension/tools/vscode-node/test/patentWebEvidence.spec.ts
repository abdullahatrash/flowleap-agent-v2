/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, it } from 'vitest';
import { ANALYTICS_RESULT_CAP, PatentExecutionSnapshot, webPageHost } from '../../../patentai/vscode-node/patentExecutionLedger';
import { recordWebPatentPages, webPatentEvidence } from '../patentWebEvidence';
import { recordingPatentLedger } from './patentLedgerTestUtils';

const google = 'https://patents.google.com/patent/GB2155808A/en';

/** A Google Patents page as the fetch tool returns it: title line, abstract, description, numbered claims, then the link blocks. */
const page = [
	'GB2155808A - Feed drum arrangement - Google Patents',
	'',
	'Abstract',
	'A feed drum arrangement for a harvester.',
	'',
	'Description',
	'The invention relates to a feed drum arrangement.',
	'The two drums rotate in the same direction.',
	'',
	'Claims (2)',
	'1. A feed arrangement comprising two drums.',
	'2. The arrangement of claim 1, wherein the drums rotate in the same direction.',
	'',
	'Similar Documents',
	'Publication Publication Date Title',
	'US1234567A 1990-01-01 Another drum',
].join('\n');

/** The fields of each source that identify it, so a case reads as a table. */
function shape(evidence: ReturnType<typeof webPatentEvidence>) {
	return evidence && { publicationNumber: evidence.publicationNumber, title: evidence.title, sources: evidence.sources.map(source => ({ anchor: source.anchor, section: source.reference.section, text: source.text, textSource: source.textSource, url: source.url })) };
}

describe('web page text as patent evidence (#750)', () => {
	it('splits a Google Patents page into description and claims under the publication anchor', () => {
		expect(shape(webPatentEvidence(google, page))).toEqual({
			publicationNumber: 'GB2155808A',
			title: 'Feed drum arrangement',
			sources: [
				{ anchor: 'GB2155808A:description', section: 'description', text: 'The invention relates to a feed drum arrangement.\nThe two drums rotate in the same direction.', textSource: 'web', url: google },
				{ anchor: 'GB2155808A:claims', section: 'claims', text: '1. A feed arrangement comprising two drums.\n2. The arrangement of claim 1, wherein the drums rotate in the same direction.', textSource: 'web', url: google },
			],
		});
	});

	it('reads the publication from each known URL shape, else from the title, and records nothing for an unknown page', () => {
		const titled = 'DE 20208107 U1 - Halterung\nGebrauchsmuster text.';
		expect({
			espacenetFields: webPatentEvidence('https://worldwide.espacenet.com/publicationDetails/biblio?CC=GB&NR=2155808A&KC=A&FT=D', 'Text.')?.publicationNumber,
			espacenetQuery: webPatentEvidence('https://worldwide.espacenet.com/patent/search?q=pn%3DJP2004174393A', 'Text.')?.publicationNumber,
			fpoNumeric: webPatentEvidence('https://www.freepatentsonline.com/4935850.html', 'Text.')?.publicationNumber,
			fpoOffice: webPatentEvidence('https://www.freepatentsonline.com/GB2155808A.html', 'Text.')?.publicationNumber,
			titleFallback: webPatentEvidence('https://depatisnet.dpma.de/DepatisNet/depatisnet?action=bibdat&docid=x', titled)?.publicationNumber,
			unknownHost: webPatentEvidence('https://example.com/patent/GB2155808A', page),
			noNumber: webPatentEvidence('https://patents.google.com/', 'Google Patents\nSearch and read the full text of patents.'),
			empty: webPatentEvidence(google, '   \n'),
			host: [webPageHost(google), webPageHost('not a url')],
		}).toEqual({
			espacenetFields: 'GB2155808A',
			espacenetQuery: 'JP2004174393A',
			fpoNumeric: 'US4935850',
			fpoOffice: 'GB2155808A',
			titleFallback: 'DE20208107U1',
			unknownHost: undefined,
			noNumber: undefined,
			empty: undefined,
			host: ['patents.google.com', 'web'],
		});
	});

	it('keeps a page without section headings as one description section, capped like any recorded result, never a bibliography anchor', () => {
		const long = 'x'.repeat(ANALYTICS_RESULT_CAP + 10);
		const flat = webPatentEvidence('https://patents.google.com/patent/US2711153A/en', 'US2711153A - Compass - Google Patents\nA compass with a card and a bowl.');
		const capped = webPatentEvidence('https://patents.google.com/patent/US2711153A/en', long);
		expect({
			flat: shape(flat),
			cappedLength: capped?.sources[0].text?.length,
			cappedTail: capped?.sources[0].text?.slice(-40),
			sections: [...new Set([...(flat?.sources ?? []), ...(capped?.sources ?? [])].map(source => source.reference.section))],
		}).toEqual({
			flat: { publicationNumber: 'US2711153A', title: 'Compass', sources: [{ anchor: 'US2711153A:description', section: 'description', text: 'US2711153A - Compass - Google Patents\nA compass with a card and a bowl.', textSource: 'web', url: 'https://patents.google.com/patent/US2711153A/en' }] },
			cappedLength: ANALYTICS_RESULT_CAP + '\n… [truncated for the audit record]'.length,
			cappedTail: 'xxxxx\n… [truncated for the audit record]',
			sections: ['description'],
		});
	});

	it('records a known page as a details outcome under the number the ledger already holds, and an unknown page as nothing', async () => {
		const recorded: PatentExecutionSnapshot = {
			limitation: 'Test.',
			executions: [{ id: 'biblio', recordedAt: '2026-10-19T01:00:00Z', kind: 'details', status: 'succeeded', publicationIds: ['US2711153A'], sources: [{ anchor: 'US2711153A:bibliography', reference: { publicationNumber: 'US2711153A', section: 'bibliography' }, retrieval: 'returned', review: 'unknown', completeness: 'unknown' }] }],
		};
		const { ledger, executions } = recordingPatentLedger();
		const notes = await recordWebPatentPages({ ...ledger, read: async () => recorded }, undefined, [
			{ url: 'https://patents.google.com/patent/US2711153/en', content: 'US2711153 - Compass - Google Patents\nDescription\nA compass with a card.\nClaims\n1. A compass.' },
			{ url: 'https://example.org/blog/compasses', content: 'Blog about US2711153.' },
		]);
		expect({ executions: executions.map(execution => ({ kind: execution.kind, publicationIds: execution.publicationIds, publicationTitle: execution.publicationTitle, anchors: execution.sources?.map(source => source.anchor) })), notes }).toEqual({
			executions: [{ kind: 'details', publicationIds: ['US2711153A'], publicationTitle: 'Compass', anchors: ['US2711153A:description', 'US2711153A:claims'] }],
			notes: ['Patent page text recorded as web evidence for US2711153A (patents.google.com): anchors US2711153A:description, US2711153A:claims. Quote it through get_patent_details(publicationNumber: "US2711153A", evidenceLookup: { anchor }) like any recorded text; never type a quote from memory. A chart row that rests on it is labelled as web page text, not official full text, and official text wins where the tools hold any.'],
		});
	});
});
