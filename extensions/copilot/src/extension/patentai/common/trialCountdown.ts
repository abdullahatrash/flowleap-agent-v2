/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The FlowLeap subscription status the client cares about, mapped down from the backend's Stripe
 * status enum (`active` | `canceled` | `past_due` | `trialing` | `incomplete`). `active` and
 * `trialing` are the two access-granting states (mirrors the backend gate, ADR 0004); every other
 * *successful* read collapses to `inactive`; `unknown` means the check was inconclusive (signed
 * out, token not ready, or the request failed) and must never drive a nag.
 */
export type FlowLeapSubscriptionStatus = 'active' | 'trialing' | 'inactive' | 'unknown';

/**
 * A single read of the user's subscription. `currentPeriodEnd` is the backend's ISO-8601
 * `date-time` string (the trial end for a `trialing` sub); it is nullable — a card-required trial
 * can carry a trial end that the backend column has not yet been populated with.
 */
export interface FlowLeapSubscriptionSnapshot {
	readonly status: FlowLeapSubscriptionStatus;
	readonly currentPeriodEnd?: string | null;
	/**
	 * True when the backend reports the subscription is set to cancel at the end of the current
	 * period (Stripe `cancelAtPeriodEnd`) — still `active` today, but ending on `currentPeriodEnd`.
	 * Lets the Account pill distinguish "Active" from "Cancels on {date}". Absent/false otherwise.
	 */
	readonly cancelAtPeriodEnd?: boolean;
}

/**
 * Whole days remaining until `currentPeriodEnd`, measured from `now` (epoch ms). Pure so the pill
 * can render "Trial · N days left" deterministically in tests by injecting `now`. Mirrors the
 * website's `trialDaysRemaining` (billing-state.ts) so both halves of the funnel count identically:
 * `ceil` of the fractional days, clamped to `0` once the end has passed (never negative), and
 * `null` when there is no usable end date.
 */
export function trialDaysRemaining(currentPeriodEnd: string | null | undefined, now: number): number | null {
	if (!currentPeriodEnd) {
		return null;
	}

	const end = new Date(currentPeriodEnd).getTime();
	if (Number.isNaN(end)) {
		return null;
	}

	const msLeft = end - now;
	if (msLeft <= 0) {
		return 0;
	}

	return Math.ceil(msLeft / (1000 * 60 * 60 * 24));
}

/**
 * The pill's render decision, derived purely from a subscription snapshot. Hidden for every state
 * except `trialing` — active (paid), inactive/no-subscription, signed-out, and inconclusive reads
 * all resolve to `{ visible: false }`, so a paid or signed-out user never sees a trial countdown.
 * When visible, `daysRemaining` is the whole-days count, or `null` when the snapshot carries no
 * usable end date (the presentation layer then shows a plain "Trial" without a count).
 */
export type TrialPillDecision =
	| { readonly visible: false }
	| { readonly visible: true; readonly daysRemaining: number | null };

/**
 * Decide whether the trial-countdown pill should show and, if so, how many days it names. Pure and
 * side-effect free so the visibility rule and the day count are unit-tested without vscode.
 */
export function decideTrialPill(snapshot: FlowLeapSubscriptionSnapshot, now: number): TrialPillDecision {
	if (snapshot.status !== 'trialing') {
		return { visible: false };
	}
	return { visible: true, daysRemaining: trialDaysRemaining(snapshot.currentPeriodEnd, now) };
}
