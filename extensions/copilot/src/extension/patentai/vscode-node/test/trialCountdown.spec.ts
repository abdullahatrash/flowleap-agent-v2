/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { decideTrialPill, trialDaysRemaining } from '../../common/trialCountdown';

const NOW = Date.parse('2026-07-06T00:00:00.000Z');

describe('trialDaysRemaining', () => {

	it('returns null when there is no end date', () => {
		expect(trialDaysRemaining(null, NOW)).toBeNull();
		expect(trialDaysRemaining(undefined, NOW)).toBeNull();
	});

	it('returns null when the end date is unparseable', () => {
		expect(trialDaysRemaining('not-a-date', NOW)).toBeNull();
	});

	it('counts whole days for an exact multiple-of-days window', () => {
		expect(trialDaysRemaining('2026-07-15T00:00:00.000Z', NOW)).toBe(9);
	});

	it('rounds a partial day up (ceil), so a nearly-elapsed day still reads as a full day left', () => {
		// 9 days + 12 hours -> 9.5 -> ceil -> 10.
		expect(trialDaysRemaining('2026-07-15T12:00:00.000Z', NOW)).toBe(10);
		// 1 ms short of a full day still counts as 1 day left.
		expect(trialDaysRemaining(new Date(NOW + 1).toISOString(), NOW)).toBe(1);
	});

	it('clamps to 0 at or past the end (never negative)', () => {
		expect(trialDaysRemaining('2026-07-06T00:00:00.000Z', NOW)).toBe(0); // exactly now
		expect(trialDaysRemaining('2026-07-01T00:00:00.000Z', NOW)).toBe(0); // already elapsed
	});
});

describe('decideTrialPill', () => {

	it('hides the pill for every non-trial state', () => {
		for (const status of ['active', 'inactive', 'unknown'] as const) {
			expect(decideTrialPill({ status, currentPeriodEnd: '2026-07-15T00:00:00.000Z' }, NOW)).toEqual({ visible: false });
		}
	});

	it('shows the pill with the day count while trialing', () => {
		expect(decideTrialPill({ status: 'trialing', currentPeriodEnd: '2026-07-15T00:00:00.000Z' }, NOW))
			.toEqual({ visible: true, daysRemaining: 9 });
	});

	it('shows the pill with a null count when trialing without a usable end date', () => {
		expect(decideTrialPill({ status: 'trialing', currentPeriodEnd: null }, NOW))
			.toEqual({ visible: true, daysRemaining: null });
	});

	it('shows the pill clamped to 0 when the trial end has passed', () => {
		expect(decideTrialPill({ status: 'trialing', currentPeriodEnd: '2026-07-01T00:00:00.000Z' }, NOW))
			.toEqual({ visible: true, daysRemaining: 0 });
	});
});
