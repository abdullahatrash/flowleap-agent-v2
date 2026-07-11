/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { decideSessionExpiry } from '../../common/sessionExpiry';

// Fixed clock so the day-count and visibility rule are deterministic.
const NOW = Date.parse('2026-07-06T00:00:00.000Z');
const DAY = 1000 * 60 * 60 * 24;

describe('decideSessionExpiry', () => {

	it('hides when signed out (no expiry)', () => {
		expect(decideSessionExpiry(undefined, NOW)).toEqual({ visible: false });
	});

	it('hides when more than 3 days remain', () => {
		expect(decideSessionExpiry(NOW + 4 * DAY, NOW)).toEqual({ visible: false });
		// 3 days + 1ms rounds (ceil) to 4 days, still outside the window.
		expect(decideSessionExpiry(NOW + 3 * DAY + 1, NOW)).toEqual({ visible: false });
	});

	it('shows the whole-days countdown within the threshold', () => {
		expect(decideSessionExpiry(NOW + 3 * DAY, NOW)).toEqual({ visible: true, expired: false, daysRemaining: 3 });
		// Half a day rounds up.
		expect(decideSessionExpiry(NOW + 1.5 * DAY, NOW)).toEqual({ visible: true, expired: false, daysRemaining: 2 });
		// 1ms short of a full day still counts as 1 day.
		expect(decideSessionExpiry(NOW + 1, NOW)).toEqual({ visible: true, expired: false, daysRemaining: 1 });
	});

	it('shows the expired variant at or past expiry', () => {
		expect(decideSessionExpiry(NOW, NOW)).toEqual({ visible: true, expired: true });
		expect(decideSessionExpiry(NOW - DAY, NOW)).toEqual({ visible: true, expired: true });
	});

	it('honors a custom threshold', () => {
		expect(decideSessionExpiry(NOW + 5 * DAY, NOW, 7)).toEqual({ visible: true, expired: false, daysRemaining: 5 });
	});
});
