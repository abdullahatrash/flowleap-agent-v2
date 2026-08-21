/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { trialPillTooltip } from '../trialCountdownStatusBar';

describe('trialPillTooltip (ADR 0015 disclosure, #243)', () => {

	it('carries the deadline and the full credential disclosure while trialing', () => {
		expect(trialPillTooltip(5)).toBe(
			'Your FlowLeap trial ends in 5 days.\n\n'
			+ 'During the trial, your trial models and patent data both run on FlowLeap\'s credentials: chat uses FlowLeap-supplied trial models via OpenRouter, and you can switch to your own key at any time. Add your own LLM API key and your EPO/USPTO data keys before the trial ends.\n\n'
			+ 'Click to review your setup.'
		);
	});

	it('keeps the disclosure in every deadline variant (no count, last day, ends today)', () => {
		for (const tooltip of [trialPillTooltip(null), trialPillTooltip(1), trialPillTooltip(0)]) {
			// Both credential deadlines named (LLM key + EPO/USPTO data keys), and the ADR 0015
			// disclosure that trial inference runs on FlowLeap-supplied models via OpenRouter.
			expect(tooltip).toContain('FlowLeap\'s credentials');
			expect(tooltip).toContain('via OpenRouter');
			expect(tooltip).toContain('EPO/USPTO');
			expect(tooltip).toContain('switch to your own key at any time');
		}
	});
});
