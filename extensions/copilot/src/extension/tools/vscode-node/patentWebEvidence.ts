/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { parsePatentDocumentReference, PatentDocumentReference } from '../../patentai/common/patentDocumentReference';
import { ANALYTICS_RESULT_CAP, capRecordedField, evidenceAnchor, IPatentExecutionLedger, PatentEvidenceSource, webPageHost } from '../../patentai/vscode-node/patentExecutionLedger';
import { documentKey, hasKindCode } from './patentFallbackLadder';

/**
 * Web page text as evidence for documents the backend holds no full text for (#750): an older US
 * grant, a GB or JP document, a DE utility model. A fetched patent page is recorded under the
 * publication anchor exactly as `get_patent_details` records official text, marked `textSource:
 * 'web'` with its URL, so the writer checks a quotation against it, the lookup pages through it,
 * and the chart labels the row. Nothing here calls a model or the network.
 */

/** One fetched page: the URL as fetched and the text the fetch tool returned. */
export interface WebPatentPage {
	readonly url: string;
	readonly content: string;
}

/** The evidence a fetched patent page gives: the publication it is about and its text by section. */
export interface WebPatentEvidence {
	readonly publicationNumber: string;
	readonly title?: string;
	readonly sources: readonly PatentEvidenceSource[];
}

/** The sections a page can be split into; a web source is never a bibliography anchor (PRD 0024 A8). */
type WebTextSection = 'description' | 'claims';

/**
 * The hosts a patent page is read from. A page elsewhere records nothing new: the analytics record
 * of the fetch stays, no source does.
 */
const PATENT_PAGE_HOSTS: readonly string[] = ['patents.google.com', 'espacenet.com', 'freepatentsonline.com', 'dpma.de', 'inpit.go.jp', 'uspto.gov', 'epo.org', 'wipo.int', 'ipo.gov.uk', 'inpi.fr', 'ic.gc.ca', 'ipaustralia.gov.au', 'kipris.or.kr', 'cnipa.gov.cn'];

/** A publication number as a path segment or title token: country code, number, optional kind code. */
const PUBLICATION_SEGMENT = /^(?<country>[A-Za-z]{2})\s?(?<number>\d{5,16})\s?(?<kind>[A-Za-z]\d?)?$/;

/** A publication number inside a page title, e.g. `GB2155808A - Feed drum - Google Patents`. */
const TITLE_PUBLICATION = /\b(?<country>[A-Z]{2})\s?(?<number>\d{5,16})\s?(?<kind>[A-Z]\d?)?\b/;

/** Espacenet's biblio page: `CC=GB&NR=2155808A&KC=A` or `CC=GB&NR=2155808&KC=A`; the kind code is read from either place. */
const ESPACENET_FIELDS = /[?&]CC=(?<country>[A-Za-z]{2})&NR=(?<number>\d+)(?<kind>[A-Za-z]\d?)?(?:&KC=(?<kc>[A-Za-z]\d?))?/;

/** Espacenet's search page: `q=pn%3DGB2155808A` or `q=pn=GB2155808A`. */
const ESPACENET_QUERY = /[?&]q=pn(?:%3D|=)(?<publication>[A-Za-z]{2}\d{5,16}(?:[A-Za-z]\d?)?)/;

/** FreePatentsOnline at the path root: `/4935850.html` is a US grant; `/GB2155808A.html` names its office. */
const FPO_PAGE = /^\/(?<publication>(?:[A-Za-z]{2})?\d{5,16}(?:[A-Za-z]\d?)?)\.html$/;

/** FreePatentsOnline's US application pages: `/y2004/0174393.html` is US2004174393. */
const FPO_APPLICATION = /^\/y(?<year>\d{4})\/(?<number>\d{5,12})\.html$/;

/** A heading that opens a text section of a patent page, with or without Markdown marks or a claim count. */
const SECTION_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?<section>Description|Claims)(?:\s*\(\d+\))?(?:\*\*)?\s*:?\s*$/i;

/** A heading that closes a text section: the other blocks of a Google Patents or office page. */
const END_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:Abstract|Info|Links|Images|Classifications|Landscapes|Concepts|Similar Documents|Cited By|Patent Citations|Non-Patent Citations|Family(?: Cites Families)?|(?:Family|Parent|Child) Applications|Priority (?:And Related )?Applications|Applications? (?:claiming priority|filed)|Worldwide applications|Publications|Legal Events|Legal status)(?:\s*\(\d+\))?(?:\*\*)?\s*:?\s*$/i;

/** A register or file-inspection host: its pages name application numbers, not published text. */
const REGISTER_HOST = /^register\./;

/** Above this many digits a kind-less number in a title is an application number, not a publication. */
const PUBLICATION_DIGITS = 8;

/** Whether the page is on a host that serves patent documents. */
function patentPageHost(url: string): boolean {
	const host = webPageHost(url);
	return PATENT_PAGE_HOSTS.some(known => host === known || host.endsWith('.' + known));
}

/** A publication number in the separator-free upper-case form the ledger uses, or nothing. */
function publicationFrom(country: string | undefined, number: string | undefined, kind: string | undefined): string | undefined {
	if (!country || !number) { return undefined; }
	const publication = `${country}${number}${kind ?? ''}`.toUpperCase();
	return parsePatentDocumentReference({ publicationNumber: publication, section: 'description' }) ? publication : undefined;
}

/** The publication the URL names, read from the shapes the known hosts use. */
function publicationFromUrl(url: string): string | undefined {
	let parsed: URL;
	try { parsed = new URL(url); } catch { return undefined; }
	const search = parsed.search;
	const fields = ESPACENET_FIELDS.exec(search)?.groups;
	if (fields) { return publicationFrom(fields.country, fields.number, fields.kind ?? fields.kc); }
	const query = ESPACENET_QUERY.exec(search)?.groups;
	if (query) {
		const token = PUBLICATION_SEGMENT.exec(query.publication)?.groups;
		return publicationFrom(token?.country, token?.number, token?.kind);
	}
	const application = parsed.hostname.endsWith('freepatentsonline.com') ? FPO_APPLICATION.exec(parsed.pathname)?.groups : undefined;
	// The epodoc form drops the serial's leading zero: `/y2004/0174393.html` is US2004174393.
	if (application) { return publicationFrom('US', `${application.year}${application.number.replace(/^0+/, '')}`, undefined); }
	const fpo = parsed.hostname.endsWith('freepatentsonline.com') ? FPO_PAGE.exec(parsed.pathname)?.groups : undefined;
	if (fpo) {
		const token = PUBLICATION_SEGMENT.exec(/^\d/.test(fpo.publication) ? `US${fpo.publication}` : fpo.publication)?.groups;
		return publicationFrom(token?.country, token?.number, token?.kind);
	}
	for (const segment of parsed.pathname.split('/')) {
		const token = PUBLICATION_SEGMENT.exec(decodeURIComponent(segment))?.groups;
		const publication = publicationFrom(token?.country, token?.number, token?.kind);
		if (publication) { return publication; }
	}
	return undefined;
}

/** The first non-empty line of the page: the title a page starts with. */
function pageTitle(content: string): string {
	return content.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '';
}

/**
 * The publication a page title names, when the URL did not. A register page, or a kind-less number
 * with more digits than a publication has, names an application whose text is not published text.
 */
function publicationFromTitle(url: string, content: string): string | undefined {
	const token = TITLE_PUBLICATION.exec(pageTitle(content).slice(0, 300))?.groups;
	if (REGISTER_HOST.test(webPageHost(url)) || (token && !token.kind && token.number.length > PUBLICATION_DIGITS)) { return undefined; }
	return publicationFrom(token?.country, token?.number, token?.kind);
}

/**
 * The document's title as a Google Patents page states it (`GB2155808A - Title - Google Patents`);
 * any other page gives no title, because the first line of an office page is not reliably one.
 */
function documentTitle(content: string, publication: string): string | undefined {
	const title = pageTitle(content);
	const match = new RegExp(String.raw`^${publication}\s*-\s*(?<title>.+?)\s*-\s*Google Patents$`, 'i').exec(title)?.groups?.title?.trim();
	return match || undefined;
}

/**
 * The number the ledger already records for this document, when the page names it without a kind
 * code: the inventory and the open points key on the recorded number, so `US2711153` on a page
 * joins `US2711153A` from the bibliography instead of becoming a second document (#729). A page
 * that names its kind code keeps it: an A and a B publication have different claims, so a fetched
 * `EP1809422B1` is never recorded under a `EP1809422A1` the ledger holds.
 */
function recordedForm(publication: string, recorded: readonly string[]): string {
	const exact = recorded.find(known => known.toUpperCase() === publication);
	if (exact || hasKindCode(publication)) { return exact ?? publication; }
	const sameDocument = recorded.filter(known => documentKey(known) === documentKey(publication));
	return sameDocument[sameDocument.length - 1] ?? publication;
}

/**
 * The page text by section: the lines under a `Description` heading and under a `Claims` heading,
 * each closed by the next known block heading. A page whose structure gives neither is one
 * `description` section holding the text before the first block heading (the citation, family
 * and legal-event lists are never disclosure text), because the quotation check needs the text
 * under some anchor and a wrong section label is a smaller harm than no text; nothing before such
 * a heading records nothing.
 */
function splitSections(content: string): ReadonlyMap<WebTextSection, string> {
	const parts = new Map<WebTextSection, string[]>();
	const lines = content.split(/\r?\n/);
	let current: WebTextSection | undefined;
	let firstEnd = lines.length;
	for (const [index, line] of lines.entries()) {
		const heading = SECTION_HEADING.exec(line)?.groups?.section?.toLowerCase();
		if (heading === 'description' || heading === 'claims') { current = heading; parts.set(current, parts.get(current) ?? []); continue; }
		if (END_HEADING.test(line)) { current = undefined; firstEnd = Math.min(firstEnd, index); continue; }
		if (current) { parts.get(current)?.push(line); }
	}
	const sections = new Map<WebTextSection, string>();
	for (const [section, lines] of parts) {
		const text = lines.join('\n').trim();
		if (text) { sections.set(section, text); }
	}
	const unstructured = lines.slice(0, firstEnd).join('\n').trim();
	if (!parts.size && unstructured) { sections.set('description', unstructured); }
	return sections;
}

/**
 * The evidence a fetched page gives, or nothing when the page is not a patent page the fetch can
 * name: a host outside the known list, or no publication number in the URL or the title. The
 * sources carry the page text by section under the publication anchor, capped like any recorded
 * result, and are never a bibliography anchor.
 *
 * @param recorded the publication numbers the ledger already holds, so the page joins its document.
 */
export function webPatentEvidence(url: string, content: string, recorded: readonly string[] = []): WebPatentEvidence | undefined {
	if (!patentPageHost(url)) { return undefined; }
	const named = publicationFromUrl(url) ?? publicationFromTitle(url, content);
	if (!named) { return undefined; }
	const publicationNumber = recordedForm(named, recorded);
	const sources: PatentEvidenceSource[] = [];
	for (const [section, text] of splitSections(content)) {
		const reference: PatentDocumentReference = { publicationNumber, section };
		sources.push({ anchor: evidenceAnchor(reference), reference, text: capRecordedField(text, ANALYTICS_RESULT_CAP), textSource: 'web', url, retrieval: 'returned', review: 'unknown', completeness: 'unknown' });
	}
	if (!sources.length) { return undefined; }
	return { publicationNumber, title: documentTitle(content, named), sources };
}

/**
 * Record every fetched patent page as a `details` outcome whose sources carry the page text, after
 * the fetch's own analytics record. Returns one line per recorded page for the tool's answer, so
 * the model knows the anchors exist and how a chart treats them; an unknown page gets no line.
 */
export async function recordWebPatentPages(ledger: IPatentExecutionLedger, session: vscode.Uri | undefined, pages: readonly WebPatentPage[]): Promise<string[]> {
	if (!pages.length) { return []; }
	const snapshot = await ledger.read(session);
	const recorded = [...new Set(snapshot.executions.flatMap(execution => (execution.sources ?? []).map(source => source.reference.publicationNumber)))];
	const notes: string[] = [];
	for (const page of pages) {
		const evidence = webPatentEvidence(page.url, page.content, recorded);
		if (!evidence) { continue; }
		await ledger.record(session, { kind: 'details', status: 'succeeded', publicationIds: [evidence.publicationNumber], publicationTitle: evidence.title, sources: evidence.sources });
		notes.push(`Patent page text recorded as web evidence for ${evidence.publicationNumber} (${webPageHost(page.url)}): anchors ${evidence.sources.map(source => source.anchor).join(', ')}. Quote it through get_patent_details(publicationNumber: "${evidence.publicationNumber}", evidenceLookup: { anchor }) like any recorded text; never type a quote from memory. A chart row that rests on it is labelled as web page text, not official full text, and official text wins where the tools hold any.`);
	}
	return notes;
}
