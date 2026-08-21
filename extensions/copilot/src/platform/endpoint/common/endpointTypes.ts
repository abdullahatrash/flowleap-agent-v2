/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export namespace CustomDataPartMimeTypes {
	export const CacheControl = 'cache_control';
	export const StatefulMarker = 'stateful_marker';
	export const ThinkingData = 'thinking';
	export const ContextManagement = 'context_management';
	export const PhaseData = 'phase_data';
	export const Usage = 'usage';
}

export const CacheType = 'ephemeral';

/**
 * Vendors of the built-in BYOK providers whose converters handle the internal
 * {@link CustomDataPartMimeTypes.CacheControl} sentinel. Others would leak it upstream (#313920).
 *
 * `flowleap-trial` is a FlowLeap addition: the Trial provider extends the OpenRouter provider and
 * so runs the very same converter as `openrouter`.
 *
 * TODO: replace with an externally exposed opt-in API (#313920).
 */
export const CacheBreakpointAwareModelVendors: ReadonlySet<string> = new Set(['anthropic', 'gemini', 'openrouter', 'flowleap-trial']);

export function modelVendorHandlesCacheBreakpoints(vendor: string | undefined): boolean {
	return !!vendor && CacheBreakpointAwareModelVendors.has(vendor.toLowerCase());
}
