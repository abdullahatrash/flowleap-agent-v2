/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FlowLeapSubscriptionSnapshot, trialDaysRemaining } from './trialCountdown';

/** The signed-in user's identity, as read from the auth provider (JWT claims + backend profile). */
export interface AccountIdentity {
	readonly name?: string;
	readonly email?: string;
}

/**
 * The subscription pill rendered next to the account identity. `tone` maps to a themed colour in the
 * webview (trial/active = positive, warn = the pending-cancellation amber, muted = no subscription).
 */
export interface AccountPill {
	readonly label: string;
	readonly tone: 'trial' | 'active' | 'warn' | 'muted';
}

/**
 * The Account section's render state, posted to the webview (asserted directly in tests — the view
 * only reflects it, never re-derives). Signed out is a single "sign in" affordance; signed in carries
 * the identity, the subscription pill (or `null` when the read was inconclusive), and whether a
 * "Manage subscription" button should show (only for users the backend recognises as Stripe customers).
 */
export type AccountState =
	| { readonly signedIn: false }
	| {
		readonly signedIn: true;
		readonly name: string | null;
		readonly email: string | null;
		readonly pill: AccountPill | null;
		readonly canManageSubscription: boolean;
	};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format an ISO-8601 date as a stable "Mon D, YYYY" (UTC) so the pill reads identically in tests. */
function formatShortDate(iso: string | null | undefined): string | null {
	if (!iso) {
		return null;
	}
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) {
		return null;
	}
	const d = new Date(ms);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Trial pill label; mirrors the status-bar countdown wording so both funnel halves read the same. */
function trialLabel(daysRemaining: number | null): string {
	if (daysRemaining === null) {
		return 'Trial';
	}
	if (daysRemaining <= 0) {
		return 'Trial · Ends today';
	}
	if (daysRemaining === 1) {
		return 'Trial · 1 day left';
	}
	return `Trial · ${daysRemaining} days left`;
}

/** Map a subscription snapshot to its pill, or `null` for an inconclusive (`unknown`) read. */
function computePill(snapshot: FlowLeapSubscriptionSnapshot, now: number): AccountPill | null {
	switch (snapshot.status) {
		case 'trialing':
			return { label: trialLabel(trialDaysRemaining(snapshot.currentPeriodEnd, now)), tone: 'trial' };
		case 'active': {
			if (snapshot.cancelAtPeriodEnd) {
				const date = formatShortDate(snapshot.currentPeriodEnd);
				return { label: date ? `Cancels on ${date}` : 'Cancels at period end', tone: 'warn' };
			}
			return { label: 'Active', tone: 'active' };
		}
		case 'inactive':
			return { label: 'No subscription', tone: 'muted' };
		case 'unknown':
			return null;
	}
}

/**
 * Derive the Account section render state purely from the auth provider's data — so the webview
 * markup stays a dumb reflector and the four states (signed out, trialing, active, cancel-at-period-
 * end) are unit-tested by asserting this object. `identity === undefined` means signed out.
 */
export function computeAccountState(identity: AccountIdentity | undefined, snapshot: FlowLeapSubscriptionSnapshot, now: number): AccountState {
	if (!identity) {
		return { signedIn: false };
	}
	return {
		signedIn: true,
		name: identity.name ?? null,
		email: identity.email ?? null,
		pill: computePill(snapshot, now),
		// Manage-subscription (the Stripe billing portal) is only meaningful for a recognised customer —
		// active or trialing. Inactive/unknown users have no portal to open.
		canManageSubscription: snapshot.status === 'active' || snapshot.status === 'trialing',
	};
}
