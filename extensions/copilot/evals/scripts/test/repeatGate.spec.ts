/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { filterPatternFor } from '../repeat-gate';

/** Real dataset descriptions — the top-up filter is handed these verbatim. */
const T3A = 'T3a — search endpoint 504s twice then succeeds: retry through the transient error and use the hits';
const T7 = 'T7 — negative control: a genuinely empty space; bounded reformulation then an honest null is CORRECT (must stay green, no runaway/fabrication)';
const T8 = 'T8 — an explicitly worldwide/comprehensive request must not ask a jurisdiction question before any search tool call';

describe('filterPatternFor', () => {
	it('matches exactly the deficient cases, escaping the regex metacharacters real descriptions carry', () => {
		const pattern = new RegExp(filterPatternFor([T3A, T7]));
		expect([T3A, T7, T8].map(d => pattern.test(d))).toEqual([true, true, false]);
	});

	it('anchors both ends so one case id cannot drag in its longer neighbour', () => {
		const pattern = new RegExp(filterPatternFor(['T3a — short']));
		expect([pattern.test('T3a — short'), pattern.test('T3a — short and then some')]).toEqual([true, false]);
	});
});
