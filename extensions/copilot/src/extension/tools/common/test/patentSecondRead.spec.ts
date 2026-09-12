/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildSecondReadRequests, parseSecondReadVerdicts, PASSAGE_WINDOW, SecondReadReview, SecondReadSnapshot, summarizeSecondRead } from '../patentSecondRead';

const snapshot: SecondReadSnapshot = {
	executions: [{
		sources: [
			{ anchor: 'EP1:claims:1:en', text: 'A device comprising a rotary cam\nand a lever fixed to the cam.' },
			{ anchor: 'EP2:claims:3:en', text: 'A device according to claim 1, wherein the cam is external.' },
		],
	}],
};

const review: SecondReadReview = {
	coverage: [
		{ feature: 'Cam pair', status: 'partial', elements: [{ element: 'a rotary cam', anchor: 'EP1:claims:1:en', disclosedBy: 'a rotary cam and a lever' }, { element: 'cam formed in the head' }] },
		{ feature: 'Unresolved track', status: 'unresolved', elements: [{ element: 'ignored' }] },
		{ feature: 'No element map', status: 'supported' },
		{ feature: 'Missing record', status: 'supported', elements: [{ element: 'an older anchor', anchor: 'EP9:claims:1:en', disclosedBy: 'text never recorded' }] },
	],
};

describe('second read requests', () => {
	it('builds one request per row that claims disclosure, with the recorded passage behind each element', () => {
		expect(buildSecondReadRequests(review, snapshot)).toEqual([
			{
				feature: 'Cam pair',
				status: 'partial',
				elements: [
					{ element: 'a rotary cam', anchor: 'EP1:claims:1:en', disclosedBy: 'a rotary cam and a lever', passage: 'A device comprising a rotary cam\nand a lever fixed to the cam.' },
					{ element: 'cam formed in the head' },
				],
			},
			{
				feature: 'Missing record',
				status: 'supported',
				elements: [{ element: 'an older anchor', anchor: 'EP9:claims:1:en', disclosedBy: 'text never recorded' }],
			},
		]);
	});

	it('keeps the cited fragment inside the window when the recorded text is longer than the cap', () => {
		const fragment = 'the cam profile carried on the stem';
		const text = 'a'.repeat(7000) + fragment + 'b'.repeat(200);
		const [request] = buildSecondReadRequests(
			{ coverage: [{ feature: 'Long passage', status: 'supported', elements: [{ element: 'cam profile', anchor: 'EP1:claims:1:en', disclosedBy: fragment }] }] },
			{ executions: [{ sources: [{ anchor: 'EP1:claims:1:en', text }] }] },
		);
		const passage = request.elements[0].passage ?? '';
		expect({ length: passage.length, keepsFragment: passage.includes(fragment), shorterThanSource: passage.length < text.length }).toEqual({ length: PASSAGE_WINDOW, keepsFragment: true, shorterThanSource: true });
	});
});

describe('second read verdicts', () => {
	it('recovers verdicts from a fenced reply with surrounding prose', () => {
		const reply = 'Here is my answer:\n```json\n{"verdicts":[{"element":"a rotary cam","verdict":"agree","reason":"The passage recites a rotary cam."},{"element":"cam formed in the head","verdict":"disagree","reason":"The lever is fixed to the cam, not formed in a head."}]}\n```\nLet me know.';
		expect(parseSecondReadVerdicts(reply)).toEqual([
			{ element: 'a rotary cam', verdict: 'agree', reason: 'The passage recites a rotary cam.' },
			{ element: 'cam formed in the head', verdict: 'disagree', reason: 'The lever is fixed to the cam, not formed in a head.' },
		]);
	});

	it('returns undefined for prose, broken JSON, an empty list and an unknown verdict word', () => {
		expect([
			parseSecondReadVerdicts('The first element looks disclosed to me.'),
			parseSecondReadVerdicts('{"verdicts":[{"element":"a","verdict":"agree"'),
			parseSecondReadVerdicts('{"verdicts":[]}'),
			parseSecondReadVerdicts('{"verdicts":[{"element":"a","verdict":"maybe","reason":"unsure"}]}'),
		]).toEqual([undefined, undefined, undefined, undefined]);
	});

	it('counts judged elements, the split over verdicts, and the rows that could not be parsed', () => {
		expect(summarizeSecondRead([
			{ feature: 'Cam pair', status: 'partial', verdicts: [{ element: 'a', verdict: 'agree', reason: 'r' }, { element: 'b', verdict: 'disagree', reason: 'r' }, { element: 'c', verdict: 'unclear', reason: 'r' }] },
			{ feature: 'Skewer', status: 'supported', verdicts: [{ element: 'd', verdict: 'agree', reason: 'r' }] },
			{ feature: 'Handle', status: 'supported', unparsed: 'I cannot answer that.' },
		])).toEqual({ elements: 4, agree: 2, disagree: 1, unclear: 1, unparsed: 1 });
	});
});
