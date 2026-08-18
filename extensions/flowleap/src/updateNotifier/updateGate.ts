/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure decision logic for the Notify-Only Checker (ADR 0008, issue #234).
 *
 * On builds where the NATIVE updater is armed (macOS Stamped Builds that carry
 * an `updateUrl` in their product configuration), the checker's background
 * polling and toasts are suppressed so users never see two competing update
 * surfaces. Everywhere else — Windows builds, dev/unstamped builds, and builds
 * where the native update service is disabled — the checker behaves exactly as
 * before. The manual `flowleap.checkForUpdates` command is exempt and works on
 * every build.
 *
 * This module MUST NOT import `vscode` (or anything else non-pure): it is
 * unit-tested under plain mocha with no extension host.
 */

/** Placeholder versions that indicate an unstamped (dev) build — never check against these. */
const PLACEHOLDER_VERSIONS = new Set(['0.0.0', '0.0.1']);

/** What triggered an update check: the background timer or the manual command. */
export type UpdateCheckTrigger = 'background' | 'manual';

/**
 * The subset of the running app's product configuration
 * (`<appRoot>/product.json`) that arms the native updater.
 */
export interface IProductUpdateConfiguration {
	readonly updateUrl?: string;
	readonly quality?: string;
	readonly commit?: string;
}

/** Plain-data inputs to the background-check decision. */
export interface IUpdateGateState {
	/** Whether the running build's native updater is armed (see {@link isNativeUpdaterArmed}). */
	readonly nativeUpdaterArmed: boolean;
	/** Whether the extension host runs in production mode (not a dev/F5 host). */
	readonly productionExtensionMode: boolean;
	/** Whether this build carries a real stamped version (see {@link isStampedVersion}). */
	readonly stampedVersion: boolean;
}

/**
 * Decides whether an update check may run. Manual checks are exempt from every
 * gate; background checks run only on stamped production builds where the
 * native updater is NOT armed.
 */
export function shouldRunUpdateCheck(trigger: UpdateCheckTrigger, state: IUpdateGateState): boolean {
	if (trigger === 'manual') {
		return true;
	}
	return state.productionExtensionMode && state.stampedVersion && !state.nativeUpdaterArmed;
}

/**
 * Whether the given product configuration arms the native updater: it must
 * carry an update URL, a quality, and a build commit. Callers that fail to
 * read or parse the product configuration must treat the updater as NOT armed
 * (fail open to the notify-only toast) by passing `undefined`.
 */
export function isNativeUpdaterArmed(product: IProductUpdateConfiguration | undefined): boolean {
	return !!(product && product.updateUrl && product.quality && product.commit);
}

/**
 * Whether the given version is a real stamped release version rather than a
 * dev/placeholder one.
 */
export function isStampedVersion(version: string): boolean {
	return !!version && !PLACEHOLDER_VERSIONS.has(version);
}
