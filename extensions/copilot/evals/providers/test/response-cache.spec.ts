/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { cacheFlagEnv, isResponseCacheEnabled, ResponseCache } from '../response-cache';

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flowleap-response-cache-'));
const TOOL_A = { type: 'function', function: { name: 'search_patents', description: 'a', parameters: {} } };
const TOOL_B = { type: 'function', function: { name: 'get_claims', description: 'b', parameters: {} } };
const request = (tools: unknown[]) => ({ model: 'm', messages: [{ role: 'user', content: 'q' }], tools, temperature: 0 });

describe('ResponseCache', () => {
	it('replays an identical request and misses when the tool list changes', () => {
		const cache = new ResponseCache(freshDir());
		cache.set(request([TOOL_A]), { output: 'answer' });

		expect([cache.get(request([TOOL_A])), cache.get(request([TOOL_A, TOOL_B]))]).toEqual([{ output: 'answer' }, undefined]);
	});

	it('is bounded by age: an entry past maxAgeMs is a miss and is removed, and the first write of a process prunes the expired files', () => {
		const dir = freshDir();
		let now = 1_000_000;
		const cache = new ResponseCache(dir, { now: () => now, maxAgeMs: 100 });
		cache.set(request([TOOL_A]), { output: 'old' });
		now += 50;
		cache.set(request([TOOL_B]), { output: 'young' });
		now += 60;

		const expiredRead = cache.get(request([TOOL_A]));
		const afterRead = fs.readdirSync(dir).length;
		const young = cache.get(request([TOOL_B]));
		const later = new ResponseCache(dir, { now: () => now + 1000, maxAgeMs: 100 });
		later.set(request([TOOL_A, TOOL_B]), { output: 'newest' });

		expect({ expiredRead, afterRead, young, afterPrune: fs.readdirSync(dir) }).toEqual({
			expiredRead: undefined,
			afterRead: 1,
			young: { output: 'young' },
			afterPrune: [expect.stringMatching(/^[0-9a-f]{64}\.json$/)],
		});
	});
});

describe('the --no-cache contract shared with promptfoo', () => {
	it('is on by default, off for PROMPTFOO_CACHE_ENABLED=false (or any non-true value) and for a bustCache context', () => {
		expect([
			isResponseCacheEnabled({}),
			isResponseCacheEnabled({ PROMPTFOO_CACHE_ENABLED: 'true' }),
			isResponseCacheEnabled({ PROMPTFOO_CACHE_ENABLED: 'false' }),
			isResponseCacheEnabled({ PROMPTFOO_CACHE_ENABLED: '0' }),
			isResponseCacheEnabled({}, { bustCache: true }),
		]).toEqual([true, true, false, false, false]);
	});

	it('turns --no-cache among the launcher args into PROMPTFOO_CACHE_ENABLED=false and leaves other runs alone', () => {
		expect([
			cacheFlagEnv(['eval', '-c', 'promptfooconfig.yaml', '--no-cache'], { A: '1' }),
			cacheFlagEnv(['eval', '-c', 'promptfooconfig.yaml'], { A: '1' }),
		]).toEqual([{ A: '1', PROMPTFOO_CACHE_ENABLED: 'false' }, { A: '1' }]);
	});
});
