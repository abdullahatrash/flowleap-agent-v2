/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escape } from '../../../util/vs/base/common/strings';
import { PatentDocumentReference, patentDocumentTarget } from '../common/patentDocumentReference';

export interface PatentReaderData {
	readonly title: string | null;
	readonly applicants: readonly string[];
	readonly publicationDate: string | null;
	readonly abstract: string | null;
	readonly claims: readonly { number: string; text: string }[];
	readonly description: string | null;
	readonly claimsError?: string;
	readonly descriptionError?: string;
	readonly loadedAt: string;
}

/** Retrieved text is always escaped, including titles, claims, errors and attributes. */
export function renderPatentDocument(reference: PatentDocumentReference, nonce: string, data?: PatentReaderData, error?: string): string {
	const target = patentDocumentTarget(reference);
	const labels = { bibliography: l10n.t('Overview'), abstract: l10n.t('Abstract'), claims: l10n.t('Claims'), description: l10n.t('Description') };
	const text = (value: string | null | undefined) => escape(value || l10n.t('Not available.'));
	const claims = data?.claims.map(claim => `<article id="claim-${escape(claim.number)}" tabindex="-1" class="claim ${claim.number === reference.claimNumber ? 'selected' : ''}"><h3>${escape(l10n.t('Claim {0}', claim.number))}</h3><div class="source-text">${escape(claim.text)}</div></article>`).join('');
	const missingClaim = data && reference.claimNumber && !data.claims.some(claim => claim.number === reference.claimNumber)
		? `<p role="status" class="notice">${escape(l10n.t('Claim {0} was not returned by the backend.', reference.claimNumber))}</p>` : '';
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{margin:0;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);line-height:1.65}main{max-width:850px;margin:auto;padding:36px 32px 100px}header{border-bottom:1px solid var(--vscode-panel-border);padding-bottom:26px}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--vscode-descriptionForeground)}h1{font-family:var(--vscode-editor-font-family);font-size:24px;margin:8px 0}h2{font-size:18px;margin:26px 0 14px}h3{font-size:13px;font-weight:600;margin:0 0 12px}header .title{font-size:18px;line-height:1.45}.meta{color:var(--vscode-descriptionForeground);font-size:12px;margin-top:14px}nav{position:sticky;top:0;display:flex;gap:24px;background:var(--vscode-editor-background);padding:14px 0;border-bottom:1px solid var(--vscode-panel-border);z-index:1}a{color:var(--vscode-textLink-foreground);text-decoration:none}a:hover{text-decoration:underline}a:focus-visible{outline:1px solid var(--vscode-focusBorder)}section,article{scroll-margin-top:65px}.source-text{white-space:pre-wrap;overflow-wrap:anywhere;font-family:Georgia,serif;font-size:16px;line-height:1.8}.claim{padding:20px;margin:0 0 16px;border-left:2px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background)}.selected,:target{border-left:3px solid var(--vscode-focusBorder);background:var(--vscode-editor-findMatchHighlightBackground)}.notice{padding:14px;border-left:3px solid var(--vscode-editorWarning-foreground);color:var(--vscode-descriptionForeground)}footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--vscode-panel-border);font-size:12px;color:var(--vscode-descriptionForeground)}@media(max-width:500px){main{padding:20px 16px 60px}nav{gap:16px}.source-text{font-size:15px}}
</style></head><body><main><header id="bibliography"><div class="eyebrow">${escape(l10n.t('FlowLeap · Patent reader'))}</div><h1>${escape(reference.publicationNumber)}</h1>${data ? `<div class="title">${text(data.title)}</div><div class="meta">${text(data.applicants.join(' · '))} · ${escape(l10n.t('Published: {0}', data.publicationDate || '—'))}</div>` : ''}</header>
${data ? `<nav aria-label="${escape(l10n.t('Document sections'))}">${Object.entries(labels).map(([id, label]) => `<a href="#${id}">${escape(label)}</a>`).join('')}</nav>${missingClaim}<section id="abstract"><h2>${escape(labels.abstract)}</h2><div class="source-text">${text(data.abstract)}</div></section><section id="claims"><h2>${escape(labels.claims)}</h2>${claims || `<p class="notice">${text(data.claimsError || l10n.t('No claims were returned.'))}</p>`}</section><section id="description"><h2>${escape(labels.description)}</h2><div class="source-text">${text(data.description || data.descriptionError)}</div></section><footer>${escape(l10n.t('Loaded through FlowLeap on {0}. This is a fresh document lookup, not a saved copy of the earlier chat evidence.', data.loadedAt))}</footer>` : `<p role="status" class="notice">${escape(error || l10n.t('Loading patent text…'))}</p>`}
</main><script nonce="${nonce}">window.addEventListener('load', () => requestAnimationFrame(() => { const target = document.getElementById(${JSON.stringify(target)}); if (target) { target.scrollIntoView(); target.focus({preventScroll:true}); } }), {once:true});</script></body></html>`;
}
