/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Result of parsing a curl command into patent_api_request parameters.
 */
export interface ICurlToApiRequestResult {
	/** Relative path, e.g. "/ops/biblio?doc=EP1234566" */
	readonly path: string;
	readonly method: 'GET' | 'POST';
	/** JSON body string, present only when method is POST and data was found */
	readonly body?: string;
	/** True when parsing succeeded cleanly */
	readonly ok: boolean;
}

/**
 * Parses a single-line curl command string and extracts the path, method, and body
 * suitable for passing to the `patent_api_request` tool.
 *
 * Handles:
 * - Full URLs (strips scheme + host, strips leading /v1)
 * - -X / --request for method
 * - -d / --data / --data-raw for body
 *
 * @param curl  The raw curl command string from a guide tool example
 * @returns     Parsed result; `ok` is false when the URL could not be extracted
 */
export function curlToApiRequest(curl: string): ICurlToApiRequestResult {
	// --- Extract URL ---
	// Match quoted or unquoted URL arg to curl: curl [-flags] "URL" or curl "URL" ...
	// We look for the first http/https URL or a bare path token after stripping flags.
	let rawUrl: string | undefined;
	const urlPattern = /https?:\/\/\S+/;
	const urlMatch = urlPattern.exec(curl);
	if (urlMatch) {
		rawUrl = urlMatch[0].replace(/['"]/g, ''); // strip surrounding quotes if any
	} else {
		// Try bare path like /ops/biblio
		const barePathMatch = /(?:^|\s)(\/[^\s'"]+)/.exec(curl);
		if (barePathMatch) {
			rawUrl = barePathMatch[1];
		}
	}

	if (!rawUrl) {
		return { path: '', method: 'GET', ok: false };
	}

	// Normalise to a relative path
	const path = normaliseToRelativePath(rawUrl);

	// --- Extract method ---
	let method: 'GET' | 'POST' = 'GET';
	const methodMatch = /(?:-X|--request)\s+([A-Z]+)/.exec(curl);
	if (methodMatch) {
		method = methodMatch[1].toUpperCase() === 'POST' ? 'POST' : 'GET';
	}

	// --- Extract body (-d / --data / --data-raw) ---
	let body: string | undefined;
	// Match: -d 'body' OR -d "body" OR --data 'body' OR --data-raw 'body'
	const bodyMatch = /(?:-d|--data(?:-raw)?)\s+(['"])([\s\S]*?)\1/.exec(curl);
	if (bodyMatch) {
		body = bodyMatch[2];
		if (method === 'GET') {
			method = 'POST'; // infer POST if body is present but -X not given
		}
	}

	return { path, method, body, ok: true };
}

/**
 * Normalises a raw URL or path to a relative path for `patent_api_request`.
 * - Strips scheme + host (http://localhost:8000)
 * - Strips a leading /v1 segment
 * - Ensures a leading /
 */
export function normaliseToRelativePath(raw: string): string {
	// Strip trailing quotes
	let s = raw.replace(/['"]/g, '');

	// Strip scheme + host (handles http://... or https://... or //...)
	s = s.replace(/^(?:https?:)?\/\/[^/]+/, '');

	// Ensure leading /
	if (!s.startsWith('/')) {
		s = '/' + s;
	}

	// Strip leading /v1
	if (s.startsWith('/v1/')) {
		s = s.slice(3); // remove '/v1'
	} else if (s === '/v1') {
		s = '/';
	}

	return s;
}

/**
 * Returns a human-readable hint string describing how to invoke `patent_api_request`
 * for the given curl command. Intended for injection into guide tool output.
 *
 * If parsing fails, returns a note to supply values manually.
 */
export function curlToApiRequestHint(curl: string): string {
	const result = curlToApiRequest(curl);
	if (!result.ok) {
		return `patent_api_request → (could not parse curl; supply path manually with method GET or POST)`;
	}
	const parts: string[] = [`path: "${result.path}"`, `method: "${result.method}"`];
	if (result.body !== undefined) {
		parts.push(`body: '${result.body}'`);
	}
	return `patent_api_request → ${parts.join(', ')}`;
}
