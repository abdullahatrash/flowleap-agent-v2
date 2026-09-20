/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { byokKnownModelToAPIInfo } from '../../common/byokProvider';
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

	it('declares the catalog context_length as the model window so the gauge stops summing input and output', () => {
		const window = (top_provider: OpenRouterModelData['top_provider']) => {
			const capabilities = openRouterModelCapabilities(model(top_provider));
			return {
				contextWindow: capabilities.contextWindow,
				published: byokKnownModelToAPIInfo('OpenRouter', 'm', capabilities).maxContextWindowTokens,
			};
		};
		// An Anthropic model's declared 200K window must reach the gauge as 200K, not as
		// 136K input + 64K output = 200K by luck and not as 200K + 64K = 264K.
		expect({
			anthropic: window({ context_length: 200000, max_completion_tokens: 64000 }),
			huge: window({ context_length: 1000000, max_completion_tokens: 200000 }),
			unknown: window({ context_length: 128000, max_completion_tokens: null }),
		}).toEqual({
			anthropic: { contextWindow: 200000, published: 200000 },
			huge: { contextWindow: 1000000, published: 1000000 },
			unknown: { contextWindow: 128000, published: 128000 },
		});
	});
});
