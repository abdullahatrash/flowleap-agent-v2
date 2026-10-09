/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers for the HTML file preview. They import no `vscode` API, so they run under plain
 * mocha on the compiled output (see `test/htmlPreviewDocument.test.ts`).
 */

/**
 * The only remote origins a previewed HTML file may load scripts, styles, fonts and images
 * from (issue #589). This is the one place the list lives; the extension README repeats it.
 *
 * A file the agent writes for a quick chart often loads a library such as Chart.js from a
 * public CDN, so these origins are allowed for code and assets. They are never allowed for
 * network requests: `connect-src` stays `'none'`, so a page cannot `fetch()`, open a WebSocket
 * or send a beacon anywhere, and there is no `frame-src`, so it cannot embed other sites.
 */
export const PREVIEW_CDN_ORIGINS: readonly string[] = [
	'https://cdn.jsdelivr.net',
	'https://unpkg.com',
	'https://cdnjs.cloudflare.com',
	'https://fonts.googleapis.com',
	'https://fonts.gstatic.com',
];

/**
 * The Content Security Policy for a previewed HTML file. The file may run its own inline
 * scripts and styles, load images and fonts from the folder the webview may read, and load
 * scripts, styles, fonts and images from {@link PREVIEW_CDN_ORIGINS}. It may not make network
 * requests (`connect-src 'none'`) and may not embed frames (`default-src 'none'`).
 *
 * @param cspSource The webview's `cspSource` (the origin of `asWebviewUri` resources).
 */
export function previewContentSecurityPolicy(cspSource: string): string {
	const cdn = PREVIEW_CDN_ORIGINS.join(' ');
	return [
		`default-src 'none'`,
		`script-src 'unsafe-inline' ${cdn}`,
		`style-src 'unsafe-inline' ${cspSource} ${cdn}`,
		`img-src ${cspSource} ${cdn} data: blob:`,
		`font-src ${cspSource} ${cdn} data:`,
		`media-src ${cspSource} data: blob:`,
		`connect-src 'none'`,
	].join('; ');
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Prepare the text of an HTML file for a webview: put the preview's Content Security Policy
 * and a `<base>` (so relative image and font paths resolve next to the file) at the start of
 * `<head>`. A document with no `<head>` gets the two elements in front of its content.
 *
 * @param html The file's text.
 * @param cspSource The webview's `cspSource`.
 * @param baseHref The webview URI of the file's folder, with a trailing slash.
 */
export function buildPreviewHtml(html: string, cspSource: string, baseHref: string): string {
	const injected = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(previewContentSecurityPolicy(cspSource))}"><base href="${escapeAttribute(baseHref)}">`;
	const head = /<head(?:\s[^>]*)?>/i.exec(html);
	if (head) {
		const end = head.index + head[0].length;
		return html.slice(0, end) + injected + html.slice(end);
	}
	return injected + html;
}
