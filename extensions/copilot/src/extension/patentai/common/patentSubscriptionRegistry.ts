/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Module-level registry so synchronous consumers — the Patent AI system prompt is built inside a
// render pass and cannot await — can read the user's LAST-KNOWN subscription snapshot without
// restructuring the DI graph. The exact pattern of patentTokenRegistry.ts and
// patentDataKeysRegistry.ts. FlowLeapAuthenticationProvider — the owner of the backend read —
// registers its accessor on construction and refreshes the cached snapshot opportunistically.

import { Emitter, Event } from '../../../util/vs/base/common/event';
import type { FlowLeapSubscriptionSnapshot, FlowLeapSubscriptionStatus } from './trialCountdown';

let _registeredSubscriptionProvider: (() => FlowLeapSubscriptionSnapshot | undefined) | undefined;

const _onDidChangePatentSubscription = new Emitter<void>();

/**
 * Fires after the last-known subscription STATUS changes — a fresh backend read resolving a
 * different status than the cached one, or a sign-out clearing the snapshot. A state-change
 * broadcast only: listeners re-read the current state through
 * {@link getPatentSubscriptionStatus} / {@link getPatentSubscriptionSnapshot} and decide their own
 * reaction (e.g. the FlowLeap Trial model provider hides itself and discards its key when the
 * status leaves `trialing`, #242).
 */
export const onDidChangePatentSubscription: Event<void> = _onDidChangePatentSubscription.event;

/**
 * Called by the snapshot owner (FlowLeapAuthenticationProvider) after the cached snapshot's status
 * changed. Must fire only on a real status transition — every resolved read re-firing it would turn
 * the hourly countdown refresh into a busy loop for listeners.
 */
export function notifyPatentSubscriptionChanged(): void {
	_onDidChangePatentSubscription.fire();
}

/**
 * Called by FlowLeapAuthenticationProvider on construction to register the snapshot accessor.
 * Must be synchronous and side-effect free — it runs on every prompt build. The accessor serves
 * the provider's last resolved snapshot, or `undefined` when the subscription has never been read.
 */
export function registerPatentSubscriptionProvider(provider: () => FlowLeapSubscriptionSnapshot | undefined): void {
	_registeredSubscriptionProvider = provider;
}

/**
 * The last-known subscription snapshot, or `undefined` when no provider is registered (stock
 * configuration, tests) or nothing has been read yet.
 */
export function getPatentSubscriptionSnapshot(): FlowLeapSubscriptionSnapshot | undefined {
	return _registeredSubscriptionProvider?.();
}

/**
 * The last-known subscription status, collapsing "never read" and "no provider registered" to
 * `unknown`. `unknown` is safe by construction: it must never drive an availability claim, so a
 * failed or missing read can never tell the model an office is dead.
 */
export function getPatentSubscriptionStatus(): FlowLeapSubscriptionStatus {
	return getPatentSubscriptionSnapshot()?.status ?? 'unknown';
}
