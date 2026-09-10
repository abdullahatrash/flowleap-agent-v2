/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../../../vscodeTypes';
import { ToolCallRound } from '../../../../prompt/common/toolCallRound';
import { ToolName } from '../../../../tools/common/toolNames';
import { patentEvidenceReadingContext } from '../patentEvidenceReading';
import { assemble } from './patentToolRoutingTestUtils';

vi.mock('../../../../../vscodeTypes', async () => import('../../../../../util/common/test/shims/vscodeTypesShim'));

const args = { publicationNumber: 'EP0983762A1', evidenceLookup: { anchor: 'EP0983762A1:claims:1:en' } };
function turn(id: string, text = 'Local returned-text lines: 5 results.\nA source passage.') {
	return { rounds: [new ToolCallRound('', [{ id, name: ToolName.GetPatentDetails, arguments: JSON.stringify(args) }])], results: { [id]: new LanguageModelToolResult([new LanguageModelTextPart(text)]) } };
}

describe('patent evidence reuse context', () => {
	it('counts an identical returned lookup across a Continue boundary without treating it as reviewed', () => {
		const memo = patentEvidenceReadingContext([turn('first'), turn('second')]);
		expect({ count: memo?.includes('"count":2'), scope: memo?.includes('not a review certificate'), claimCopy: memo?.includes('quote is omitted') }).toEqual({ count: true, scope: true, claimCopy: true });
	});
	it('does not count rejected or missing tool results as returned evidence', () => {
		expect(patentEvidenceReadingContext([turn('bad', 'ERROR: invalid input'), { rounds: turn('absent').rounds, results: {} }])).toBeUndefined();
	});
	it('recovers a deferred result from Continue and does not count replay of the same call twice', () => {
		const pending = { ...turn('deferred'), results: {}, maxToolCallsExceeded: true };
		const continued = { rounds: [], results: turn('deferred').results };
		expect(patentEvidenceReadingContext([pending, continued])).toContain('"count":1');
		expect(patentEvidenceReadingContext([pending, turn('deferred')])).toContain('"count":1');
	});
	it('includes the reuse context in the real provider prompt assembly', async () => {
		const result = await assemble('gemini-3.8-flash', ToolName.GetPatentDetails, 'Local returned-text lines: 5 results.\nA source passage.', true, false, JSON.stringify(args));
		expect(result.text).toContain('Patent evidence lookup history');
		expect(result.text).toContain('"count":1');
	});
});
