/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getPatentSubscriptionSnapshot, getPatentSubscriptionStatus, registerPatentSubscriptionProvider } from '../../common/patentSubscriptionRegistry';
import type { FlowLeapSubscriptionSnapshot } from '../../common/trialCountdown';

describe('patentSubscriptionRegistry', () => {

	// Runs first, before any registration in this module instance: the never-registered read is
	// the state a stock (non-FlowLeap) configuration and every prompt build before the first
	// backend read sees, and it must be unknown-safe rather than throwing or claiming access.
	it('reads unknown-safe when no provider is registered', () => {
		expect({ snapshot: getPatentSubscriptionSnapshot(), status: getPatentSubscriptionStatus() })
			.toEqual({ snapshot: undefined, status: 'unknown' });
	});

	it('serves the registered accessor synchronously, including a later last-known snapshot', () => {
		let lastKnown: FlowLeapSubscriptionSnapshot | undefined;
		registerPatentSubscriptionProvider(() => lastKnown);

		const beforeFirstRead = { snapshot: getPatentSubscriptionSnapshot(), status: getPatentSubscriptionStatus() };
		lastKnown = { status: 'trialing', currentPeriodEnd: '2026-08-01T00:00:00.000Z' };
		const afterTrialRead = { snapshot: getPatentSubscriptionSnapshot(), status: getPatentSubscriptionStatus() };
		// A later inconclusive read overwrites the cache, so a stale 'trialing' can never survive.
		lastKnown = { status: 'unknown' };
		const afterInconclusiveRead = { snapshot: getPatentSubscriptionSnapshot(), status: getPatentSubscriptionStatus() };

		expect({ beforeFirstRead, afterTrialRead, afterInconclusiveRead }).toEqual({
			beforeFirstRead: { snapshot: undefined, status: 'unknown' },
			afterTrialRead: { snapshot: { status: 'trialing', currentPeriodEnd: '2026-08-01T00:00:00.000Z' }, status: 'trialing' },
			afterInconclusiveRead: { snapshot: { status: 'unknown' }, status: 'unknown' },
		});
	});
});
