/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildTrialCheckoutUrl, hasByokModel } from '../onboardingBridge';

describe('buildTrialCheckoutUrl', () => {
	it('appends the pricing path to the frontend origin', () => {
		expect(buildTrialCheckoutUrl('https://flowleap.co')).toBe('https://flowleap.co/pricing');
	});

	it('does not double the slash when the origin has a trailing slash', () => {
		expect(buildTrialCheckoutUrl('https://flowleap.co/')).toBe('https://flowleap.co/pricing');
		expect(buildTrialCheckoutUrl('http://localhost:3000//')).toBe('http://localhost:3000/pricing');
	});
});

describe('hasByokModel', () => {
	it('is true when at least one real provider vendor is present', () => {
		expect(hasByokModel(['openrouter'])).toBe(true);
		expect(hasByokModel(['copilot', 'anthropic'])).toBe(true);
	});

	it('is false for agent pseudo-vendors only', () => {
		expect(hasByokModel(['copilot', 'flowleap', 'claude-code'])).toBe(false);
	});

	it('is false when no models are present', () => {
		expect(hasByokModel([])).toBe(false);
	});
});
