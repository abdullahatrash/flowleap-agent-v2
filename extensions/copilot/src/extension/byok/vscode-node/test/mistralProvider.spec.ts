/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { MistralModelData, mistralModelCapabilities, selectMistralListings } from '../mistralProvider';

describe('mistralProvider', () => {
	const chat = (id: string, extra: Partial<MistralModelData> = {}): MistralModelData => ({
		id,
		capabilities: { completion_chat: true, function_calling: true, vision: false },
		max_context_length: 131072,
		...extra,
	});

	it('keeps one row per model across dated ids, rolling aliases and shared names; retired models drop', () => {
		const listing: MistralModelData[] = [
			// Live shape: three ids, one shared name, aliases pointing at each other.
			chat('codestral-2508', { name: 'codestral-2508', aliases: ['codestral-latest'] }),
			chat('codestral-latest', { name: 'codestral-2508', aliases: ['codestral-2508'] }),
			chat('codestral-2508-v2', { name: 'codestral-2508', aliases: [] }),
			// Dated id with no rolling alias listed keeps the dated id.
			chat('mistral-large-2512', { name: 'mistral-large-2512', aliases: ['mistral-large-latest'] }),
			// No aliases at all, distinct names: both stay.
			chat('glm-5-2', { name: 'glm-5-2' }),
			chat('zai-glm-5-3', { name: 'zai-glm-5-3' }),
			// Same name, no aliases: still one row.
			chat('mistral-medium-latest', { name: 'mistral-medium-latest' }),
			chat('mistral-medium-2508', { name: 'mistral-medium-latest' }),
			// Retired.
			chat('mistral-medium-2505', { name: 'mistral-medium-2505', deprecation: '2026-01-01T00:00:00Z' }),
		];
		const kept = selectMistralListings(listing, new Date('2026-10-07T00:00:00Z')).map(m => m.id);
		expect(kept).toEqual(['codestral-latest', 'mistral-large-2512', 'glm-5-2', 'zai-glm-5-3', 'mistral-medium-latest']);
	});

	it('maps the listing to capabilities and hides models that cannot chat', () => {
		const caps = (model: MistralModelData) => mistralModelCapabilities(model);
		expect({
			large: caps(chat('mistral-large-latest', { name: 'Mistral Large', capabilities: { completion_chat: true, function_calling: true, vision: false } })),
			pixtral: caps(chat('pixtral-large-latest', { capabilities: { completion_chat: true, function_calling: true, vision: true } })),
			small: caps(chat('ministral-3b-latest', { max_context_length: 8192, capabilities: { completion_chat: true } })),
			unknownWindow: caps({ id: 'open-mistral-7b', capabilities: { completion_chat: true } }),
			ocr: caps(chat('mistral-ocr-latest', { capabilities: { completion_chat: false } })),
			embed: caps(chat('mistral-embed', { capabilities: { completion_chat: false, function_calling: false } })),
		}).toEqual({
			large: { name: 'Mistral Large', toolCalling: true, vision: false, contextWindow: 131072, maxInputTokens: 115072, maxOutputTokens: 16000 },
			pixtral: { name: 'Pixtral Large Latest', toolCalling: true, vision: true, contextWindow: 131072, maxInputTokens: 115072, maxOutputTokens: 16000 },
			small: { name: 'Ministral 3b Latest', toolCalling: false, vision: false, contextWindow: 8192, maxInputTokens: 4096, maxOutputTokens: 4096 },
			unknownWindow: { name: 'Open Mistral 7b', toolCalling: false, vision: false, contextWindow: 32768, maxInputTokens: 16768, maxOutputTokens: 16000 },
			ocr: undefined,
			embed: undefined,
		});
	});
});
