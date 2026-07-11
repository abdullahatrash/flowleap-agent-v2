/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { computeAccountState } from '../../common/accountSection';

// Fixed clock so the trial day-count is deterministic.
const NOW = Date.parse('2026-07-06T00:00:00.000Z');
const IDENTITY = { name: 'Ada Lovelace', email: 'ada@example.com' };

describe('computeAccountState', () => {

	it('signed out (no identity) is a bare sign-in affordance', () => {
		expect(computeAccountState(undefined, { status: 'unknown' }, NOW)).toEqual({ signedIn: false });
	});

	it('trialing shows the day-count pill and can manage the subscription', () => {
		expect(computeAccountState(IDENTITY, { status: 'trialing', currentPeriodEnd: '2026-07-15T00:00:00.000Z' }, NOW)).toEqual({
			signedIn: true,
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			pill: { label: 'Trial · 9 days left', tone: 'trial' },
			canManageSubscription: true,
		});
	});

	it('active (paid) shows an Active pill', () => {
		expect(computeAccountState(IDENTITY, { status: 'active', currentPeriodEnd: '2026-08-06T00:00:00.000Z' }, NOW)).toEqual({
			signedIn: true,
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			pill: { label: 'Active', tone: 'active' },
			canManageSubscription: true,
		});
	});

	it('active + cancelAtPeriodEnd shows the cancellation date', () => {
		expect(computeAccountState(IDENTITY, { status: 'active', currentPeriodEnd: '2026-08-06T00:00:00.000Z', cancelAtPeriodEnd: true }, NOW)).toEqual({
			signedIn: true,
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			pill: { label: 'Cancels on Aug 6, 2026', tone: 'warn' },
			canManageSubscription: true,
		});
	});

	it('inactive shows a muted No subscription pill and hides Manage', () => {
		expect(computeAccountState(IDENTITY, { status: 'inactive' }, NOW)).toEqual({
			signedIn: true,
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			pill: { label: 'No subscription', tone: 'muted' },
			canManageSubscription: false,
		});
	});

	it('an inconclusive read shows no pill, and coerces a missing name/email to null', () => {
		expect(computeAccountState({ email: 'solo@example.com' }, { status: 'unknown' }, NOW)).toEqual({
			signedIn: true,
			name: null,
			email: 'solo@example.com',
			pill: null,
			canManageSubscription: false,
		});
	});
});
