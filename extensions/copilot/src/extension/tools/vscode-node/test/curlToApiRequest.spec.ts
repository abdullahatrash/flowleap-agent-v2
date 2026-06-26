/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { curlToApiRequest, curlToApiRequestHint, normaliseToRelativePath } from '../curlToApiRequest';

// `curlToApiRequest` is the pure helper the opsApiGuide / usptoApiGuide / patentApiRequest tools share
// to turn the backend's documented `curl` examples into patent_api_request params (and to normalise the
// LLM-supplied path before it reaches the IPatentBackendClient seam). It has no service dependencies, so
// it is tested in isolation here.

describe('normaliseToRelativePath', () => {
	it('strips scheme+host from a full URL', () => {
		expect(normaliseToRelativePath('http://localhost:8000/v1/ops/biblio?doc=EP1')).toBe('/ops/biblio?doc=EP1');
	});

	it('strips leading /v1 from a /v1-prefixed path', () => {
		expect(normaliseToRelativePath('/v1/ops/biblio?doc=EP1')).toBe('/ops/biblio?doc=EP1');
	});

	it('passes through an already-normalised relative path', () => {
		expect(normaliseToRelativePath('/ops/biblio?doc=EP1')).toBe('/ops/biblio?doc=EP1');
	});

	it('all three forms resolve to the same path', () => {
		const a = normaliseToRelativePath('http://localhost:8000/v1/ops/biblio?doc=EP1234566');
		const b = normaliseToRelativePath('/v1/ops/biblio?doc=EP1234566');
		const c = normaliseToRelativePath('/ops/biblio?doc=EP1234566');
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it('handles https scheme', () => {
		expect(normaliseToRelativePath('https://api.prod.co/v1/patent-search')).toBe('/patent-search');
	});
});

describe('curlToApiRequest', () => {
	it('parses a simple GET curl command', () => {
		const result = curlToApiRequest('curl "http://localhost:8000/v1/ops/biblio?doc=EP1"');
		expect(result.ok).toBe(true);
		expect(result.path).toBe('/ops/biblio?doc=EP1');
		expect(result.method).toBe('GET');
		expect(result.body).toBeUndefined();
	});

	it('parses a POST curl command with -d body', () => {
		const result = curlToApiRequest('curl -X POST http://localhost:8000/v1/citation-search -d \'{"a":1}\'');
		expect(result.ok).toBe(true);
		expect(result.method).toBe('POST');
		expect(result.path).toBe('/citation-search');
		expect(result.body).toBe('{"a":1}');
	});

	it('infers POST when body is present but -X not given', () => {
		const result = curlToApiRequest('curl http://localhost:8000/v1/search -d \'{"q":"test"}\'');
		expect(result.ok).toBe(true);
		expect(result.method).toBe('POST');
	});

	it('returns ok=false when no URL found', () => {
		const result = curlToApiRequest('echo "hello"');
		expect(result.ok).toBe(false);
	});

	it('produces a readable hint string', () => {
		const hint = curlToApiRequestHint('curl "http://localhost:8000/v1/ops/biblio?doc=EP1"');
		expect(hint).toContain('patent_api_request');
		expect(hint).toContain('/ops/biblio?doc=EP1');
	});

	it('produces a hint string for POST with body', () => {
		const hint = curlToApiRequestHint('curl -X POST http://h/v1/citation-search -d \'{"a":1}\'');
		expect(hint).toContain('POST');
		expect(hint).toContain('/citation-search');
		expect(hint).toContain('{"a":1}');
	});
});
