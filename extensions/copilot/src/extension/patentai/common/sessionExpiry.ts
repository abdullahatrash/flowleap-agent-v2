/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Show the expiry nudge once the FlowLeap session has this many whole days or fewer remaining. */
export const EXPIRY_NUDGE_THRESHOLD_DAYS = 3;

/**
 * The expiry-nudge render decision, derived purely from the session's token-expiry timestamp so the
 * visibility rule is unit-tested against a fixed clock. Hidden when signed out or when more than the
 * threshold days remain; otherwise visible as either the whole-days countdown or the expired variant.
 */
export type SessionExpiryDecision =
	| { readonly visible: false }
	| { readonly visible: true; readonly expired: true }
	| { readonly visible: true; readonly expired: false; readonly daysRemaining: number };

/**
 * Decide whether the FlowLeap session-expiry nudge should show. `expiresAt` is the token-expiry
 * epoch-ms (or `undefined` when signed out). Pure and side-effect free. `daysRemaining` uses `ceil`
 * of the fractional days — matching the trial countdown — so a token 2½ days out reads as "3 days".
 * An `expiresAt` at or before `now` is the expired variant (the token is held but past its lifetime).
 */
export function decideSessionExpiry(expiresAt: number | undefined, now: number, thresholdDays: number = EXPIRY_NUDGE_THRESHOLD_DAYS): SessionExpiryDecision {
	if (expiresAt === undefined) {
		return { visible: false };
	}
	const msLeft = expiresAt - now;
	if (msLeft <= 0) {
		return { visible: true, expired: true };
	}
	const daysRemaining = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
	if (daysRemaining > thresholdDays) {
		return { visible: false };
	}
	return { visible: true, expired: false, daysRemaining };
}
