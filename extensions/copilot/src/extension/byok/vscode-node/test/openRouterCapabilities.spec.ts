/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { openRouterModelCapabilities, OpenRouterModelData } from '../openRouterProvider';

describe('openRouterModelCapabilities', () => {
	const model = (top_provider: OpenRouterModelData['top_provider']): OpenRouterModelData => ({ id: 'm', name: 'M', supported_parameters: ['tools'], top_provider });

	it('reserves the reported completion ceiling, bounded, and keeps the old default when OpenRouter does not know it', () => {
		const budget = (top_provider: OpenRouterModelData['top_provider']) => {
			const { maxInputTokens, maxOutputTokens } = openRouterModelCapabilities(model(top_provider));
			return { maxInputTokens, maxOutputTokens };
		};
		expect({
			reported: budget({ context_length: 200000, max_completion_tokens: 64000 }),
			huge: budget({ context_length: 1000000, max_completion_tokens: 200000 }),
			small: budget({ context_length: 32000, max_completion_tokens: 4096 }),
			unknown: budget({ context_length: 128000, max_completion_tokens: null }),
			absent: budget({ context_length: 128000 }),
		}).toEqual({
			reported: { maxInputTokens: 136000, maxOutputTokens: 64000 },
			huge: { maxInputTokens: 936000, maxOutputTokens: 64000 },
			small: { maxInputTokens: 27904, maxOutputTokens: 4096 },
			unknown: { maxInputTokens: 112000, maxOutputTokens: 16000 },
			absent: { maxInputTokens: 112000, maxOutputTokens: 16000 },
		});
	});
});
