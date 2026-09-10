/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { completedEvaluationText } from './patentToolRoutingCompletion';

describe('live routing evaluation completion', () => {
	it('rejects budget exhaustion after tool calls even when the model says it saved the report', () => {
		const responses = Array.from({ length: 32 }, () => ({ content: 'The report is saved. Checking one more passage.', tool_calls: [{ id: 'lookup', function: { name: 'get_patent_details' } }] }));
		expect(() => completedEvaluationText(responses.at(-1))).toThrow('exhausted its round budget');
	});
	it('accepts a nonempty terminal answer after the tool loop', () => {
		expect(completedEvaluationText({ content: 'Saved the reviewed report.', tool_calls: [] })).toBe('Saved the reviewed report.');
	});
	it('rejects an empty terminal response', () => {
		expect(() => completedEvaluationText({ content: '  ' })).toThrow('empty terminal response');
	});
});
