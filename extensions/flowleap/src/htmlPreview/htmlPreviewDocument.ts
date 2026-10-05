/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers for the HTML file preview. They import no `vscode` API, so they run under plain
 * mocha on the compiled output (see `test/htmlPreviewDocument.test.ts`).
 */

/**
 * The Content Security Policy for a previewed HTML file. The file is a self-contained
 * single-file document (a dashboard by recipe), so it may run its own inline scripts and
 * styles, and load images and fonts only from the folder the webview may read. It may not
 * load scripts from anywhere and may not make network requests.
 *
 * @param cspSource The webview's `cspSource` (the origin of `asWebviewUri` resources).
 */
export function previewContentSecurityPolicy(cspSource: string): string {
	return [
		`default-src 'none'`,
		`script-src 'unsafe-inline'`,
		`style-src 'unsafe-inline' ${cspSource}`,
		`img-src ${cspSource} data: blob:`,
		`font-src ${cspSource} data:`,
		`media-src ${cspSource} data: blob:`,
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
