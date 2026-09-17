/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { OPENROUTER_BASE_URL, OPENROUTER_EU_BASE_URL, openRouterBaseUrlForRegion } from '../openRouterProvider';

describe('openRouterBaseUrlForRegion', () => {

	it('routes only the eu region to the in-region host and falls back to global otherwise', () => {
		expect([
			openRouterBaseUrlForRegion('eu'),
			openRouterBaseUrlForRegion('global'),
			// an unset, stale or misspelled value must never silently strand the user off-host
			openRouterBaseUrlForRegion(undefined),
			openRouterBaseUrlForRegion(''),
			openRouterBaseUrlForRegion('europe'),
			openRouterBaseUrlForRegion('EU'),
		]).toEqual([
			OPENROUTER_EU_BASE_URL,
			OPENROUTER_BASE_URL,
			OPENROUTER_BASE_URL,
			OPENROUTER_BASE_URL,
			OPENROUTER_BASE_URL,
			OPENROUTER_BASE_URL,
		]);
	});

	it('keeps both hosts on the same API version path, so only the host differs', () => {
		expect([OPENROUTER_BASE_URL, OPENROUTER_EU_BASE_URL]).toEqual([
			'https://openrouter.ai/api/v1',
			'https://eu.openrouter.ai/api/v1',
		]);
	});
});
