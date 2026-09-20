/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parsePatentDocumentReference } from '../../patentai/common/patentDocumentReference';
import { SecondReadOutcome, secondReadLimitation, unconfirmedVerdicts } from '../common/patentSecondRead';
import { patentCitationLink } from '../../patentai/vscode-node/patentCitationLink';
import { PatentEvidenceSource, PatentExecution, PatentExecutionSnapshot } from '../../patentai/vscode-node/patentExecutionLedger';
import { escape } from '../../../util/vs/base/common/strings';

/**
 * Which structured report the coverage machinery is producing. The checks are identical; only the
 * wording of the content rule and of the rendered statuses differs, because an invalidity chart's
 * rows are the challenged patent's claim elements and its sources are the prior art.
 */
export type CandidateReviewVariant = 'prior-art' | 'invalidity';

export interface PatentCandidateReview {
	readonly coverage?: readonly {
		readonly feature: string;
		readonly kind?: 'feature' | 'combination';
		readonly importance: 'essential' | 'optional';
		readonly status: 'supported' | 'partial' | 'unresolved';
		/** invalidity-claim-chart: the challenged claim this row is an element of, e.g. `1`. */
		readonly claimNumber?: string;
		/** Required by the tool schema, but an unresolved row may arrive without it; never dereference unguarded. */
		readonly sourceAnchors?: readonly string[];
		readonly gap: string;
		readonly evidence?: readonly { readonly anchor: string; readonly quote?: string; readonly scope: string; readonly qualifiers: string; readonly quantityBasis: string }[];
		/**
		 * The constituents the feature requires, each with the cited passage — or the recorded drawing
		 * page — that discloses it. A status is otherwise a one-bit judgment: the element map is what
		 * makes it checkable.
		 */
		readonly elements?: readonly {
			readonly element: string;
			readonly anchor?: string;
			readonly disclosedBy?: string;
			/** `figure` marks an element disclosed by a recorded drawing page; absent means text. */
			readonly basis?: 'text' | 'figure';
			/** What the model says the drawing clearly shows; stands in place of `disclosedBy` for a figure. */
			readonly reading?: string;
		}[];
	}[];
	readonly content?: string;
	readonly limitations?: readonly string[];
	readonly stopReason?: string;
	/** invalidity-claim-chart: the patent whose claims are being charted against the cited art. */
	readonly challengedPublication?: string;
	/** Report prose the template renders outside the appendix; checked like every other model-written field. */
	readonly objective?: string;
	readonly searchStrategy?: string;
	/** The technology the report is about; the working record names it so a later session recognizes the matter. */
	readonly subject?: string;
	/**
	 * The concept-synonym table the queries were built from. An attorney judging whether a search was
	 * competent reads it first, so the client report shows it instead of leaving it in the session.
	 */
	readonly concepts?: readonly PatentSearchConcept[];
	/** The classification codes the search covered, each with its meaning in plain words. */
	readonly classifications?: readonly PatentClassificationEntry[];
}

/** One concept the queries were built from, and the synonyms and variations searched for it. */
interface PatentSearchConcept {
	readonly concept: string;
	readonly synonyms: readonly string[];
}

/** One classification code the search covered, with its meaning in plain words. */
interface PatentClassificationEntry {
	readonly code: string;
	readonly meaning: string;
}

/**
 * Assertive legal conclusions a candidate review must not draw. Matched case-insensitively and on
 * word boundaries, so "anticipate" never fires on "anticipated" (its own entry) and "novelty gap"
 * never fires on "novelty gaps".
 */
const LEGAL_CONCLUSION_PHRASES: readonly string[] = [
	'teach away', 'teaches away', 'teaching away', 'core novelty', 'novelty gap', 'novelty gaps',
	'is novel', 'are novel', 'not novel', 'clearly novel', 'anticipate', 'anticipates', 'anticipated by',
	'anticipation', 'obvious over', 'would have been obvious', 'obvious combination', 'is obvious', 'obviousness',
	'non-obvious', 'nonobvious', 'inventive step', 'patentable', 'unpatentable', 'patentability evaluation', 'patentability assessment',
	'patentability determination', 'patentability conclusion', 'patentability opinion', 'novelty assessment',
	'novelty evaluation', 'novelty determination', 'novelty conclusion', 'freedom to operate',
];

/**
 * Report the legal conclusions written into model-supplied prose. A disclaimer of the form
 * "does not establish novelty" is the opposite of a conclusion, so a match whose preceding 60
 * characters disclaim establishment is exempt.
 */
function legalConclusions(fields: readonly (readonly [string, string | undefined])[]): string[] {
	const findings: string[] = [];
	for (const [field, value] of fields) {
		if (!value) { continue; }
		for (const phrase of LEGAL_CONCLUSION_PHRASES) {
			const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'gi');
			for (const match of value.matchAll(pattern)) {
				const start = match.index ?? 0;
				// A disclaimer ("does not establish novelty", "no assessment of anticipation or obviousness is
				// made", "does not constitute a patentability opinion") is the opposite of a conclusion.
				const preceding = value.slice(Math.max(0, start - 80), start);
				if (/\b(?:no|not|never|without)\b(?:\s+\S+){0,3}\s+(?:establish|assess|determin|constitut|evaluat|address|opin|conclud|provid|offer|render|reach|decid|form|impl|represent|draw|mak|made|claim|purport|intend)\w*/i.test(preceding) || /\b(?:no|not)\s+$/i.test(preceding)) { continue; }
				// A sentence that defers the question to counsel, or disclaims being a legal opinion, is
				// likewise not a conclusion ("conclusions on novelty should be confirmed by patent counsel").
				const sentenceStart = Math.max(value.lastIndexOf('.', start - 1), value.lastIndexOf(';', start - 1), value.lastIndexOf('\n', start - 1)) + 1;
				const sentenceEndIndex = [value.indexOf('.', start), value.indexOf(';', start), value.indexOf('\n', start)].filter(index => index >= 0);
				const sentence = value.slice(sentenceStart, sentenceEndIndex.length ? Math.min(...sentenceEndIndex) : value.length);
				if (/\b(?:counsel|attorney|legal (?:question|opinion|advice|determination))\b|\bnot (?:a|an)\b[^.;]{0,60}\bopinion\b/i.test(sentence)) { continue; }
				findings.push(`"${match[0]}" in ${field}`);
			}
		}
	}
	return findings;
}

/** A retrieved document with the recorded facts every automatic disclosure is generated from. */
interface RetrievedDocument {
	readonly publication: string;
	readonly publicationDate: string;
	readonly publicationTitle: string;
	/**
	 * Sections whose text was actually recorded, so an empty retrieval is not reported as available,
	 * followed by the recorded drawing pages: a figure is not text and is listed as what it is.
	 */
	readonly sectionsWithText: readonly string[];
	/** Claims language, else description language, else `unrecorded`; never inferred from the text. */
	readonly language: string;
	readonly cited: boolean;
}

/** Anchors the model put in coverage, by either sourceAnchors or evidence. */
function citedAnchors(review: PatentCandidateReview): Set<string> {
	return new Set((review.coverage ?? []).flatMap(row => [...(row.sourceAnchors ?? []), ...(row.evidence ?? []).map(item => item.anchor)]));
}

/** Inventory of documents a succeeded detail or figure retrieval brought into the session. */
function retrievedDocuments(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot): readonly RetrievedDocument[] {
	const cited = citedAnchors(review);
	interface DocumentRecord { date?: string; title?: string; sections: Set<string>; figurePages: Set<number>; languages: Map<string, string>; cited: boolean }
	// The backend echoes ids as `EP0983762.A1` while source references carry `EP0983762A1`; both
	// name one document, so records are keyed on the separator-free form and shown that way.
	const documents = new Map<string, DocumentRecord>();
	const entry = (publication: string): DocumentRecord => {
		const key = publicationKey(publication);
		const existing = documents.get(key);
		if (existing) { return existing; }
		const created: DocumentRecord = { sections: new Set<string>(), figurePages: new Set<number>(), languages: new Map<string, string>(), cited: false };
		documents.set(key, created);
		return created;
	};
	for (const execution of snapshot.executions) {
		// A drawing retrieval brings a document into the session exactly as a text retrieval does; what
		// it records is pages, not passages.
		if ((execution.kind !== 'details' && execution.kind !== 'figures') || execution.status !== 'succeeded') { continue; }
		// A figures call that returned no drawing retrieved nothing. The record keeps the call as an
		// audit fact, but an inventory of retrieved documents must not list it, and the count of
		// retrieved-but-uncited documents must not hold a document no page was ever returned for.
		if (execution.kind === 'figures' && !execution.sources?.length) { continue; }
		for (const publication of execution.publicationIds ?? []) {
			const document = entry(publication);
			document.date ??= execution.publicationDate;
			document.title ??= execution.publicationTitle;
		}
		for (const source of execution.sources ?? []) {
			const document = entry(source.reference.publicationNumber);
			if (source.figure) { document.figurePages.add(source.figure.page); }
			else if (source.text?.trim()) { document.sections.add(source.reference.section); }
			if (source.language && !document.languages.has(source.reference.section)) { document.languages.set(source.reference.section, source.language); }
			if (cited.has(source.anchor)) { document.cited = true; }
		}
	}
	return [...documents].map(([publication, document]) => ({
		publication,
		publicationDate: document.date ?? 'Unknown',
		publicationTitle: document.title ?? 'Unknown',
		sectionsWithText: [...document.sections, ...(document.figurePages.size ? [`figures (${document.figurePages.size === 1 ? 'page' : 'pages'} ${pageRuns([...document.figurePages])})`] : [])],
		language: document.languages.get('claims') ?? document.languages.get('description') ?? 'unrecorded',
		cited: document.cited,
	}));
}

/** Recorded drawing pages as contiguous runs, so eight pages read as `3-10` rather than as a list. */
function pageRuns(pages: readonly number[]): string {
	const sorted = [...new Set(pages)].sort((first, second) => first - second);
	const runs: string[] = [];
	for (let index = 0; index < sorted.length;) {
		let end = index;
		while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) { end++; }
		runs.push(sorted[index] === sorted[end] ? `${sorted[index]}` : `${sorted[index]}-${sorted[end]}`);
		index = end + 1;
	}
	return runs.join(', ');
}

/** A recorded language that is neither English nor absent; only such text needs a translation notice. */
function untranslated(document: RetrievedDocument): boolean {
	return document.language !== 'unrecorded' && !/^en$/i.test(document.language);
}

/** CQL classification fields (`ic`, `cpc`, `cl`) plus the plain code names a query may spell out. */
const CLASSIFICATION_QUERY = /\b(?:cpc|ipc|cpci)\b|\b(?:ic|cl)\s*[=:]/i;

/** Below this many characters an element fragment matches too much text to prove disclosure. */
const WEAK_FRAGMENT_LENGTH = 12;

/**
 * Limitations the report states on its own behalf, generated from the execution record rather than
 * supplied by the model, so an undisclosed gap cannot survive the writer's own summary.
 */
function automaticLimitations(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, documents: readonly RetrievedDocument[]): string[] {
	const lines: string[] = [];
	const jurisdictions = searchedJurisdictions(snapshot);
	const outside = documents.filter(document => outsideScope(document.publication, jurisdictions));
	if (outside.length) {
		lines.push(`Outside the searched jurisdictions (${jurisdictions.join(', ')}): ${outside.map(document => document.publication).join(', ')}. These were reached through cited references or direct retrieval, not through the scoped search; findings that rest on them are outside the confirmed scope unless the scope is widened.`);
	}
	const uncited = documents.filter(document => !document.cited);
	if (uncited.length) {
		lines.push(`${uncited.length} of ${documents.length} retrieved documents are not cited in any coverage row; their text was available locally and was not reviewed for this report.`);
	}
	const foreign = documents.filter(untranslated);
	if (foreign.length) {
		lines.push(`Retrieved text is not in English for ${foreign.map(document => `${document.publication} (${document.language})`).join(', ')}; any quotation or reading of those documents in this report is the model's own translation and was not independently verified.`);
	}
	const sources = sourceIndex(snapshot);
	const cited = citedAnchors(review);
	if (cited.size && ![...cited].some(anchor => sources.get(anchor)?.reference.section === 'description')) {
		const retrieved = documents.filter(document => document.sectionsWithText.includes('description')).map(document => document.publication);
		lines.push(`No description passage is cited; every finding rests on claim text only. Descriptions were retrieved for: ${retrieved.join(', ') || 'none'}.`);
	}
	const searches = searchExecutions(snapshot);
	// Numbered over the succeeded searches only, in searchSets()'s own order, so "Search set N" names
	// row N of the client report's table; a failed or cancelled execution earns no number there.
	const succeededSearches = searches.filter(execution => execution.status === 'succeeded');
	const tails = succeededSearches.flatMap((execution, index) => execution.total !== undefined && execution.returned !== undefined && execution.total > execution.returned
		? [`Search set ${index + 1} returned ${execution.returned} of ${execution.total} matches; the remaining ${execution.total - execution.returned} were not retrieved.`]
		: []);
	if (tails.length) { lines.push(tails.join(' ')); }
	const unrun = unretriedQueries(snapshot);
	if (unrun.length) {
		lines.push(`${unrun.length} search(es) could not be run and were not retried: ${unrun.join('; ')}. Coverage those queries would have tested is missing from this report.`);
	}
	// Only a search that ran covered a class; an attempt that failed covered nothing, so it cannot
	// suppress the warning that the recorded coverage rests on keywords alone.
	if (succeededSearches.length && !succeededSearches.some(execution => CLASSIFICATION_QUERY.test(execution.effectiveQuery ?? execution.query ?? ''))) {
		lines.push('No classification-code (CPC/IPC) query was recorded; the search relied on keywords only.');
	}
	const weak = (review.coverage ?? []).filter(row => row.status !== 'unresolved').flatMap(row => (row.elements ?? [])
		.filter(element => element.disclosedBy !== undefined && element.disclosedBy.trim().length < WEAK_FRAGMENT_LENGTH)
		.map(element => `${row.feature} / ${element.element}`));
	if (weak.length) {
		lines.push(`Element fragments under ${WEAK_FRAGMENT_LENGTH} characters: ${weak.join(', ')}; short fragments prove little.`);
	}
	if ((review.coverage ?? []).some(row => (row.elements ?? []).some(element => figurePage(element, sources) !== undefined))) {
		lines.push('Findings marked "rests on a drawing reading" rest on the model\'s reading of a retrieved figure, not on quoted text; a drawing discloses arrangement, never dimensions unless stated to scale.');
	}
	return lines;
}

/** The recorded searches, in the order they were run; the client report shows only the succeeded ones. */
function searchExecutions(snapshot: PatentExecutionSnapshot): readonly PatentExecution[] {
	return snapshot.executions.filter(execution => execution.kind === 'search');
}

/** The query text a failed record is named by, so a search that never ran can still be reported. */
function requestedQuery(execution: PatentExecution): string {
	return execution.query?.trim() || 'query not recorded';
}

/** The feature a search said it tests, once trimmed; absent when the model named none. */
function searchPurpose(execution: PatentExecution): string | undefined {
	return execution.purpose?.trim() || undefined;
}

/**
 * The distinct queries that failed or were cancelled and never ran successfully afterwards, each
 * named by the feature it was meant to test when the model stated one. A query whose identical text
 * later succeeded was retried, so it costs no coverage and is not reported.
 */
function unretriedQueries(snapshot: PatentExecutionSnapshot): readonly string[] {
	const searches = searchExecutions(snapshot);
	const succeeded = new Set(searches.filter(execution => execution.status === 'succeeded').map(requestedQuery));
	// Keyed on the query text, so one query attempted twice is one missing coverage entry; the first
	// stated purpose wins, and a later attempt that names one fills a gap the first attempt left.
	const unretried = new Map<string, string | undefined>();
	for (const execution of searches) {
		const query = requestedQuery(execution);
		if (execution.status === 'succeeded' || succeeded.has(query)) { continue; }
		const purpose = searchPurpose(execution);
		if (!unretried.has(query) || (purpose && !unretried.get(query))) { unretried.set(query, purpose); }
	}
	return [...unretried].map(([query, purpose]) => purpose ? `${purpose} (${query})` : query);
}

/** Anchor to recorded source, the single index every pass over a snapshot shares. */
function sourceIndex(snapshot: PatentExecutionSnapshot): Map<string, PatentEvidenceSource> {
	return new Map(snapshot.executions.flatMap(execution => execution.sources ?? []).map(source => [source.anchor, source]));
}

/** Collapse runs of whitespace so a line-wrapped passage still contains its quoted fragment. */
function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** `EP0983762.A1` and `EP0983762A1` name one document; both reduce to the same key. */
function publicationKey(publication: string): string {
	return publication.replace(/[-.\s/]/g, '').toUpperCase();
}

/**
 * The office that published a document. Both the ledger's dotted ids and its source references
 * start with the two-letter country code, so it is read rather than inferred.
 */
export function publicationCountry(publication: string): string {
	return publicationKey(publication).slice(0, 2);
}

/**
 * The jurisdictions the recorded searches were actually scoped to: the union of the country filters
 * the succeeded searches applied, falling back to the two-letter codes of the requested countries
 * when no effective filter was recorded. An empty result means no jurisdiction scope was applied,
 * so no document can be reported as lying outside one.
 */
export function searchedJurisdictions(snapshot: PatentExecutionSnapshot): readonly string[] {
	const codes = new Set<string>();
	for (const execution of snapshot.executions) {
		if (execution.kind !== 'search' || execution.status !== 'succeeded') { continue; }
		const requested = [...(execution.requestedCountries ?? '').matchAll(/[A-Za-z]{2}/g)].map(match => match[0]);
		for (const code of execution.countryFilter?.length ? execution.countryFilter : requested) {
			const normalized = code.trim().toUpperCase();
			if (/^[A-Z]{2}$/.test(normalized)) { codes.add(normalized); }
		}
	}
	return [...codes].sort();
}

/** A document reached outside the confirmed search scope; never true when no scope was applied. */
function outsideScope(publication: string, jurisdictions: readonly string[]): boolean {
	return jurisdictions.length > 0 && !jurisdictions.includes(publicationCountry(publication));
}

/**
 * Publications a row's own anchors resolve to that lie outside the searched jurisdictions, so a
 * finding resting on a document the scoped search never covered says so under the row itself.
 */
function rowScopeNotes(row: PatentCoverageRow, sources: Map<string, PatentEvidenceSource>, jurisdictions: readonly string[]): string[] {
	if (!jurisdictions.length) { return []; }
	const publications = new Set<string>();
	for (const anchor of [...(row.sourceAnchors ?? []), ...(row.evidence ?? []).map(item => item.anchor)]) {
		const publication = sources.get(anchor)?.reference.publicationNumber;
		if (publication && outsideScope(publication, jurisdictions)) { publications.add(publicationKey(publication)); }
	}
	return [...publications].map(publication => `Scope note (generated): ${publication} is outside the searched jurisdictions (${jurisdictions.join(', ')}).`);
}

type PatentCoverageRow = NonNullable<PatentCandidateReview['coverage']>[number];
type PatentCoverageElement = NonNullable<PatentCoverageRow['elements']>[number];

/** An element claims disclosure once either locator is present; a bare topic match claims neither. */
function claimsDisclosure(element: PatentCoverageElement): boolean {
	return Boolean(element.anchor?.trim() || element.disclosedBy?.trim() || element.reading?.trim());
}

/**
 * The recorded drawing page an element rests on: it must say it rests on one and the page must be a
 * recorded figure source, so the report never promises a drawing the audit does not hold.
 */
function figurePage(element: PatentCoverageElement, sources: Map<string, PatentEvidenceSource>): number | undefined {
	return element.basis === 'figure' && element.anchor ? sources.get(element.anchor)?.figure?.page : undefined;
}

/**
 * What a drawing reading may not state: a number with a unit, a ratio of two numbers, or a word of
 * proportion. A drawing discloses that an element exists and how the parts are arranged, never a
 * dimension or a ratio unless it is stated to be to scale (MPEP 2125), so such a reading is rejected
 * unless the same reading says the drawing is to scale. The unit list holds no bare `in` and no bare
 * `m`, and the approximation words hold no `about`: a reading names parts by reference numeral, so
 * "the cam 12 in engagement with the lever" and "pivots about pin 14" are ordinary prose, not
 * measurements, and rejecting them would cost more honest readings than the unit catches.
 */
const FIGURE_MEASUREMENT = /\d+(?:[.,]\d+)?\s*(?:(?:mm|cm|nm|\u00b5m|um|inches|inch|degrees|deg)\b|[\u00b0%])|\d+\s*:\s*\d+|\b(?:ratio|proportion|proportional|twice|half the|times the)\b|\b(?:approximately|roughly)\s+\d/i;

/** A reading that states the drawing is to scale may state what the drawing is drawn to. */
const DRAWN_TO_SCALE = /\bto scale\b/i;

/**
 * Check one element's locators against the recorded text, so "supported" rests on a fragment that
 * actually exists in a cited passage rather than on a passage that merely shares the topic.
 */
function elementDisclosureErrors(row: PatentCoverageRow, element: PatentCoverageElement, sources: Map<string, PatentEvidenceSource>): string[] {
	const errors: string[] = [];
	const anchor = element.anchor?.trim();
	const fragment = element.disclosedBy?.trim();
	if (anchor && sources.get(anchor)?.figure) {
		return [`Element "${element.element}" of "${row.feature}" cites ${anchor}, a recorded drawing page, as text. A drawing has no quotable text: cite it with basis: figure and a reading of what the figure clearly shows, and no disclosedBy.`];
	}
	if (!anchor || !fragment) {
		errors.push(`Element "${element.element}" of "${row.feature}" cites ${anchor ? 'no literal fragment' : 'no source anchor'}. Give both the anchor and a literal fragment of its recorded text, or omit both and name the element in the gap.`);
		return errors;
	}
	if (!(row.sourceAnchors ?? []).includes(anchor)) {
		errors.push(`Element "${element.element}" of "${row.feature}" cites ${anchor}, which is not one of that row's sourceAnchors. Cite one of: ${(row.sourceAnchors ?? []).join(', ') || 'none listed'}.`);
		return errors;
	}
	const source = sources.get(anchor);
	if (!source?.text) {
		errors.push(`Recorded text for ${anchor} is an older record; retrieve once with get_patent_details(publicationNumber, evidenceLookup: {}) so the fragment for element "${element.element}" can be checked.`);
		return errors;
	}
	if (!normalizeText(source.text).toLowerCase().includes(normalizeText(fragment).toLowerCase())) {
		errors.push(`disclosedBy "${fragment}" for element "${element.element}" is not found in the recorded text of ${anchor}; copy a literal fragment from evidenceLookup output.`);
	}
	return errors;
}

/**
 * Check one element that rests on a drawing. The anchor must be a recorded figure page of this row,
 * the reading must say what the drawing shows, and it must not state a dimension or a proportion the
 * drawing does not disclose.
 */
function figureElementErrors(row: PatentCoverageRow, element: PatentCoverageElement, sources: Map<string, PatentEvidenceSource>): string[] {
	const anchor = element.anchor?.trim();
	const reading = element.reading?.trim();
	if (!anchor || !reading) {
		return [`Element "${element.element}" of "${row.feature}" rests on a drawing but ${anchor ? 'states no reading' : 'cites no figure anchor'}. Give the PUB:figure:N anchor printed by get_patent_figures and a reading of what the drawing clearly shows, or drop basis: figure and cite a literal fragment of recorded text.`];
	}
	if (element.disclosedBy?.trim()) {
		return [`Element "${element.element}" of "${row.feature}" rests on a drawing, so it carries no disclosedBy: a figure has no quotable text. Keep the reading and remove disclosedBy.`];
	}
	if (!(row.sourceAnchors ?? []).includes(anchor)) {
		return [`Element "${element.element}" of "${row.feature}" cites ${anchor}, which is not one of that row's sourceAnchors. Cite one of: ${(row.sourceAnchors ?? []).join(', ') || 'none listed'}.`];
	}
	if (!sources.get(anchor)?.figure) {
		return [`Element "${element.element}" of "${row.feature}" cites ${anchor}, which is not a recorded drawing page. Retrieve the drawing once with get_patent_figures(publicationNumber) and cite the PUB:figure:N anchor it prints.`];
	}
	if (FIGURE_MEASUREMENT.test(reading) && !DRAWN_TO_SCALE.test(reading)) {
		return [`Reading "${reading}" for element "${element.element}" states a measurement or proportion. A drawing does not disclose dimensions, proportions or ratios unless it is stated to be to scale (MPEP 2125); state only what the figure clearly shows.`];
	}
	return [];
}

/**
 * Enforce the element map: a supported row discloses every element by cited text or by a recorded
 * drawing, a partial row discloses some and names the rest, and a supported combination rests on a
 * single publication.
 */
function elementMapErrors(row: PatentCoverageRow, sources: Map<string, PatentEvidenceSource>): string[] {
	if (row.status === 'unresolved') { return []; }
	const elements = row.elements ?? [];
	if (!elements.length) {
		return [`Coverage for "${row.feature}" is marked ${row.status} but lists no elements. List each constituent the feature requires with the literal fragment of cited text that discloses it; an element without a fragment makes the row partial at most.`];
	}
	const errors: string[] = [];
	for (const element of elements) {
		if (!element.element?.trim()) { errors.push(`Every element of "${row.feature}" needs the constituent it names.`); continue; }
		if (row.status === 'supported' && !claimsDisclosure(element)) {
			errors.push(`Element "${element.element}" of "${row.feature}" is not disclosed by any cited text, so the row cannot be supported. Either cite the passage that discloses it (anchor + literal fragment) or mark the row partial and name the missing element in the gap.`);
			continue;
		}
		if (row.status === 'supported' || claimsDisclosure(element)) { errors.push(...(element.basis === 'figure' ? figureElementErrors(row, element, sources) : elementDisclosureErrors(row, element, sources))); }
	}
	if (row.status === 'partial') {
		const disclosed = elements.filter(claimsDisclosure).length;
		if (disclosed === elements.length) { errors.push(`Every element of "${row.feature}" is disclosed. Either mark the row supported, or keep it partial and ADD one element naming what the cited text does not disclose (the missing part of a range, an unmet qualifier, a constituent) with no anchor and no disclosedBy; do not remove the disclosed elements.`); }
		if (!disclosed) { errors.push(`No element of "${row.feature}" is disclosed by cited text. Either mark the row unresolved, or keep it partial and give at least one element an anchor and a literal disclosedBy fragment; a partial row needs both a disclosed and an undisclosed element.`); }
	}
	if (row.kind === 'combination' && row.status === 'supported') {
		const publications = new Set(elements.flatMap(element => {
			const publication = element.anchor ? sources.get(element.anchor)?.reference.publicationNumber : undefined;
			return publication ? [publicationKey(publication)] : [];
		}));
		if (publications.size > 1) { errors.push(`Elements of "${row.feature}" are disclosed by ${[...publications].join(' and ')}: separate documents do not establish the combination; mark partial and say which document lacks which element.`); }
	}
	return errors;
}

/** Numbered claims can be copied from the ledger instead of transcribed by the model. */
export function materializeCandidateReview<T extends PatentCandidateReview>(review: T, snapshot: PatentExecutionSnapshot): T {
	const sources = sourceIndex(snapshot);
	return { ...review, coverage: review.coverage?.map(row => ({ ...row, evidence: row.evidence?.map(evidence => {
		const source = sources.get(evidence.anchor);
		if (!source?.reference.claimNumber || !source.text) { return evidence; }
		// A numbered claim is always rendered whole: an omitted quote is copied from the record, and a
		// partial quotation that lies inside the claim expands to the whole claim instead of being rejected.
		const partial = !!evidence.quote?.trim() && normalizeText(source.text).includes(normalizeText(evidence.quote));
		return { ...evidence, quote: !evidence.quote?.trim() || partial ? source.text : evidence.quote };
	}) })) };
}

/** Validate explicit review structure and anchor identity, not the truth or entailment of prose. */
export function validateCandidateReview(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, citedText = '', variant: CandidateReviewVariant = 'prior-art'): string[] {
	const errors: string[] = [];
	const sources = sourceIndex(snapshot);
	const anchors = new Set(sources.keys());
	if (review.content?.trim()) { errors.push(`For ${variant === 'invalidity' ? 'invalidity-claim-chart with coverage' : 'prior-art-report'}, content must be empty. Put source evidence and gaps in coverage; the writer generates the assessment so a separate narrative or matrix cannot contradict downgraded statuses.`); }
	// Only application-owned source URLs are checked; external citations and semantic assertions need review.
	// The match stops before trailing prose punctuation and closers, so a sentence-final period or a
	// surrounding bracket is not read as part of the claim number.
	for (const match of citedText.matchAll(/[a-z][a-z0-9+.-]*:\/\/flowleap\.patent-ai\/patent\?[^\s)>\]}"'`]*[^\s)>\]}"'`.,;:!?]/gi)) {
		const url = new URL(match[0]);
		const reference = parsePatentDocumentReference({ publicationNumber: url.searchParams.get('publication'), section: url.searchParams.get('section'), ...(url.searchParams.has('claim') ? { claimNumber: url.searchParams.get('claim') } : {}) });
		const known = reference && snapshot.executions.some(execution => execution.sources?.some(source => source.reference.publicationNumber === reference.publicationNumber && source.reference.section === reference.section && source.reference.claimNumber === reference.claimNumber));
		if (!known) { errors.push(`Unresolved patent reader citation: ${match[0]}. Retrieve the exact section/claim or remove the unsupported citation.`); }
	}
	if (!review.coverage?.length) { errors.push('Supply coverage for essential features and their combination, including unresolved tracks.'); }
	for (const row of review.coverage ?? []) {
		if (!row.feature?.trim() || !['essential', 'optional'].includes(row.importance) || !['supported', 'partial', 'unresolved'].includes(row.status)) { errors.push('Every coverage row needs a feature, importance, and valid status.'); }
		if (row.status !== 'unresolved' && !row.sourceAnchors?.length) { errors.push(`Coverage for "${row.feature}" needs known source anchors or unresolved status.`); }
		for (const anchor of row.sourceAnchors ?? []) { if (!anchors.has(anchor)) { errors.push(`Unknown source anchor: ${anchor}. Recover known IDs with get_patent_details(publicationNumber, evidenceLookup: {}); do not repeat searches or downgrade a conclusion merely to pass validation.`); } }
		if (!['feature', 'combination'].includes(row.kind ?? '')) { errors.push(`Identify coverage kind (feature or combination) for "${row.feature}".`); }
		for (const anchor of row.sourceAnchors ?? []) {
			const source = sources.get(anchor);
			const evidence = row.evidence?.find(item => item.anchor === anchor);
			if (source?.figure) {
				// A recorded drawing page holds no text to quote; it is cited through an element instead.
				if (evidence) { errors.push(`Evidence entry for ${anchor} quotes a recorded drawing page, which holds no text. Remove it and cite the drawing through an element with basis: figure and a reading of what it clearly shows.`); }
				continue;
			}
			if (row.status !== 'unresolved' && source && !['claims', 'description'].includes(source.reference.section)) { errors.push(`Feature support for ${anchor} requires a claim or description passage, not a bibliography/overview citation. Recover the exact source section with get_patent_details.`); }
			if (row.status !== 'unresolved' && !evidence) { errors.push(`Row "${row.feature}" lists ${anchor} in sourceAnchors (or an element cites it) without an evidence entry. Add an evidence entry for ${anchor} with scope, qualifiers and quantityBasis; quote may be omitted for a numbered claim (the writer copies it) and is required verbatim for a description passage.`); }
			if (evidence) {
				if (!source?.text) { errors.push(`No recorded text for ${anchor} (older record): retrieve it once with get_patent_details so the quotation can be checked.`); }
				else if (!evidence.quote?.trim()) { errors.push(`Evidence for ${anchor} needs a verbatim quote: a description passage must be quoted exactly as returned (only numbered claims may omit quote). Copy it from evidenceLookup.anchor output.`); }
				else if (!normalizeText(source.text).includes(normalizeText(evidence.quote))) { errors.push(`Quotation for ${anchor} is not found in its recorded text. Copy the passage verbatim from evidenceLookup.anchor output; do not paraphrase or merge lines.`); }
				if (source?.reference.claimNumber && source.text && normalizeText(evidence.quote ?? '') !== normalizeText(source.text)) { errors.push(`Quote the complete claim for ${anchor}, including dependency language, qualifiers and every constituent; do not extract only a numeric range.`); }
				if (![evidence.scope, evidence.qualifiers, evidence.quantityBasis].every(value => value?.trim())) { errors.push(`Review scope/dependency, qualifiers and original quantity basis for ${anchor}. Keep original units and all constituents; do not substitute an unverified percentage conversion.`); }
			}
		}
		if (row.evidence?.some(item => !(row.sourceAnchors ?? []).includes(item.anchor))) { errors.push(`Evidence for "${row.feature}" must use that row's sourceAnchors.`); }
		errors.push(...elementMapErrors(row, sources));
		if (row.status !== 'supported' && !row.gap?.trim()) { errors.push(`Describe the remaining gap for "${row.feature}".`); }
	}
	if (!review.coverage?.some(row => row.importance === 'essential')) { errors.push('Identify at least one essential feature or combination.'); }
	if (!review.limitations?.some(value => value.trim())) { errors.push('Supply the search and evidence limitations.'); }
	if (!review.stopReason?.trim()) { errors.push('Supply stopReason: explain synthesis, remaining gaps, or the user-requested boundary.'); }
	if (!review.coverage?.some(row => row.kind === 'combination' && row.importance === 'essential')) { errors.push('Include an explicit essential combination row; it may honestly remain unresolved.'); }
	return errors;
}

/**
 * Phrases in model-written prose that read as legal conclusions. The filter cannot separate a
 * conclusion from the disclaimer that denies it reliably enough to refuse a save, so the finding is
 * rendered in the report and reported to the model instead of rejecting the draft. Quotations are
 * verbatim source text and are never scanned; only prose the model wrote itself is.
 */
export function candidateWordingReview(review: PatentCandidateReview): string[] {
	return legalConclusions([
		['objective', review.objective],
		['searchStrategy', review.searchStrategy],
		...(review.concepts ?? []).flatMap(entry => [
			[`concept "${entry.concept}"`, entry.concept] as const,
			[`synonyms for "${entry.concept}"`, entry.synonyms.join(', ')] as const,
		]),
		...(review.classifications ?? []).map(entry => [`classification ${entry.code}`, entry.meaning] as const),
		...(review.coverage ?? []).flatMap(row => [
			[`coverage feature for "${row.feature}"`, row.feature] as const,
			[`coverage gap for "${row.feature}"`, row.gap] as const,
			...(row.elements ?? []).flatMap(element => element.reading?.trim() ? [[`element reading for "${element.element}"`, element.reading] as const] : []),
			...(row.evidence ?? []).flatMap(evidence => [
				[`evidence scope for ${evidence.anchor}`, evidence.scope] as const,
				[`evidence qualifiers for ${evidence.anchor}`, evidence.qualifiers] as const,
				[`evidence quantity basis for ${evidence.anchor}`, evidence.quantityBasis] as const,
			]),
		]),
		...(review.limitations ?? []).map((value, index) => [`limitations[${index}]`, value] as const),
		['stopReason', review.stopReason],
	]);
}

function cell(value: string): string { return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

/** How each status word reads in an invalidity chart, where a row is one element of a granted claim. */
const INVALIDITY_STATUS: Readonly<Record<PatentCoverageRow['status'], string>> = {
	supported: 'disclosed in the cited art',
	partial: 'partially disclosed',
	unresolved: 'not found in the cited art',
};

/** One cited publication, the rows citing it, and whether a disclosed row rests on it by itself. */
interface ReferenceRole {
	readonly publication: string;
	readonly rows: readonly string[];
	readonly alone: boolean;
}

/**
 * The publications coverage cites, read off the statuses the author wrote: a reference is `alone`
 * where some supported row cites it and no other document. This is a reading of this chart, not an
 * X/Y/A category and not a conclusion about anticipation or obviousness.
 */
export function referenceRoles(review: PatentCandidateReview, sources: Map<string, PatentEvidenceSource>): readonly ReferenceRole[] {
	const roles = new Map<string, { rows: string[]; alone: boolean }>();
	for (const row of review.coverage ?? []) {
		const publications = new Set([...(row.sourceAnchors ?? []), ...(row.evidence ?? []).map(item => item.anchor), ...(row.elements ?? []).flatMap(element => element.anchor ? [element.anchor] : [])]
			.flatMap(anchor => {
				const publication = sources.get(anchor)?.reference.publicationNumber;
				return publication ? [publicationKey(publication)] : [];
			}));
		for (const publication of publications) {
			const role = roles.get(publication) ?? { rows: [], alone: false };
			role.rows.push(row.feature);
			role.alone ||= row.status === 'supported' && publications.size === 1;
			roles.set(publication, role);
		}
	}
	return [...roles].map(([publication, role]) => ({ publication, rows: role.rows, alone: role.alone }));
}

/** The distinct challenged claims the rows name, in the order the rows name them. */
export function challengedClaims(review: PatentCandidateReview): readonly string[] {
	return [...new Set((review.coverage ?? []).flatMap(row => row.claimNumber?.trim() ? [row.claimNumber.trim()] : []))];
}

/** The generated roles table; empty for a prior-art review, which states no reference roles. */
function referenceRoleTable(review: PatentCandidateReview, sources: Map<string, PatentEvidenceSource>): string[] {
	const roles = referenceRoles(review, sources);
	if (!roles.length) { return []; }
	return ['', '## Reference roles (generated)',
		'Derived from the statuses in this chart, not a legal category: a reference is listed as disclosing on its own where a row marked disclosed cites it and no other document, and as contributing in combination otherwise. This is not an X/Y/A tag and asserts nothing about anticipation, obviousness or inventive step.',
		'| Reference | Cited in | Role (generated) |',
		'| --- | --- | --- |',
		...roles.map(role => '| ' + [role.publication, role.rows.join('; '), role.alone ? 'discloses element(s) on its own' : 'contributes in combination'].map(cell).join(' | ') + ' |'),
		''];
}

/** Render retrieved text as literal quotation content, never as Markdown or active source HTML. */
function quotation(text: string): string {
	const missingImage = /<img\b[^>]*>/i.test(text);
	const literal = text.replace(/<img\b[^>]*>/gi, '[Formula/image unavailable in retrieved text]');
	const escaped = escape(literal).replace(/\r?\n/g, '<br />');
	// HTML block content is not parsed as Markdown; pre-wrap preserves indentation without code styling.
	return ['', `<blockquote>\n<p style="white-space: pre-wrap">${escaped}</p>\n</blockquote>`, '',
		...(missingImage ? ['Formula/image placeholders were replaced by omission notices above. Consult the original document for the missing structures.', ''] : [])].join('\n');
}

/**
 * The row's element map: what the feature requires beside the literal fragment that discloses it,
 * so a reader can see which constituent each cited passage actually covers.
 */
function elementMap(row: PatentCoverageRow, sources: Map<string, PatentEvidenceSource>): string[] {
	if (!row.elements?.length) { return []; }
	return ['', '| Element | Disclosed by | Source |', '| --- | --- | --- |',
		...row.elements.map(element => {
			const anchor = element.anchor;
			const fragment = element.disclosedBy?.trim();
			const source = anchor ? sources.get(anchor) : undefined;
			const page = figurePage(element, sources);
			const reading = element.reading?.trim();
			// A drawing reading is the model's own reading of an image, so it is never rendered as a quote.
			if (anchor && page !== undefined && reading) {
				return '| ' + [cell(element.element), `Figure page ${page} — model reading of the drawing, not quoted text: "${cell(reading)}"`,
					source ? patentCitationLink(anchor, source.reference) : anchor].join(' | ') + ' |';
			}
			return '| ' + [cell(element.element),
				anchor && fragment ? '`' + cell(fragment) + '`' : 'not disclosed in cited text',
				anchor && fragment ? (source ? patentCitationLink(anchor, source.reference) : anchor) : '—'].join(' | ') + ' |';
		}), ''];
}

/**
 * How much of a row's disclosure rests on a drawing rather than on quoted text. A reader weighing a
 * status has to see it in the status line, not only in the element map further down. An unresolved
 * row establishes no disclosure at all, so it rests on nothing and carries no suffix.
 */
function drawingReadingSuffix(row: PatentCoverageRow, sources: Map<string, PatentEvidenceSource>): string {
	if (row.status === 'unresolved') { return ''; }
	const disclosed = (row.elements ?? []).filter(claimsDisclosure);
	const drawings = disclosed.filter(element => figurePage(element, sources) !== undefined);
	if (!drawings.length) { return ''; }
	return drawings.length === disclosed.length ? ' · rests on a drawing reading' : ' · rests in part on a drawing reading';
}

/** Collapse a model-written phrase onto one line so it cannot break the list it is rendered into. */
function inline(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/**
 * What an independent read of the same passages did not confirm for this row. Only elements the
 * judge disagreed with or could not resolve are shown; the row's status is left as the author wrote
 * it, because the second read is a reading of the cited text, not an authority over the report.
 */
function secondReadNotes(row: PatentCoverageRow, secondRead: SecondReadOutcome | undefined): string[] {
	if (secondRead?.kind !== 'judged') { return []; }
	const unconfirmed = unconfirmedVerdicts(secondRead.rows.filter(result => result.feature === row.feature));
	// An element that rests on a drawing was never sent to the judge; saying so keeps the counts honest.
	const drawings = (row.elements ?? []).filter(element => element.basis === 'figure');
	if (!unconfirmed.length && !drawings.length) { return []; }
	return ['', `Second read (generated, ${secondRead.model}): the following elements were not confirmed by an independent read of the cited text; the row's status is the author's judgment.`,
		...unconfirmed.map(item => `- ${inline(item.element)}: ${item.verdict} — ${inline(item.reason)}`),
		...drawings.map(element => `- ${inline(element.element)}: not judged — rests on a drawing reading`), ''];
}

/** The recorded language of a document, with the translation notice a non-English text needs. */
function textLanguage(document: RetrievedDocument): string {
	return document.language + (untranslated(document) ? ' (not in English; any reading of it in this report is the model\'s own translation)' : '');
}

/**
 * The documents no coverage row cites: the same table under the client report's
 * "Retrieved but not cited in coverage" and the working record's "Retrieved but not read".
 */
function uncitedDocumentTable(uncited: readonly RetrievedDocument[]): string[] {
	if (!uncited.length) { return ['Every retrieved document is cited in at least one coverage row.']; }
	return [
		'| Publication | Publication date | Title | Sections with text | Text language |',
		'| --- | --- | --- | --- | --- |',
		...uncited.map(document => '| ' + [document.publication, document.publicationDate, document.publicationTitle, document.sectionsWithText.join(', ') || 'none recorded', textLanguage(document)].map(cell).join(' | ') + ' |'),
	];
}

/**
 * The tool identity the search sets are attributed to. The ledger records no provider, and
 * `search_patents` is the only tool that records a search outcome, so the column names what was
 * recorded rather than a database the record cannot confirm.
 */
const SEARCH_SOURCE = 'search_patents';

/**
 * The client-facing strategy table: one row per search that actually ran. A query that could not be
 * run is a missing-coverage sentence in Limitations, not a row of `unknown` in a table of evidence.
 */
function searchSets(snapshot: PatentExecutionSnapshot, documents: readonly RetrievedDocument[]): string[] {
	const searches = searchExecutions(snapshot).filter(execution => execution.status === 'succeeded');
	return ['## Search sets',
		...(searches.length ? [
			'| Source | Query | Scope | Hits | Tests |',
			'| --- | --- | --- | --- | --- |',
			...searches.map(execution => '| ' + [SEARCH_SOURCE, execution.effectiveQuery ?? execution.query ?? 'unknown', execution.countryFilter?.length ? execution.countryFilter.join(', ') : 'not filtered', String(execution.total ?? 'unknown'), searchPurpose(execution) ?? '—'].map(cell).join(' | ') + ' |'),
			'',
		] : []),
		`${searches.length} search sets run; ${documents.length} documents retrieved.`,
		''];
}

/** The concept-synonym table, rendered only when the writer was given one. */
function conceptTable(review: PatentCandidateReview): string[] {
	if (!review.concepts?.length) { return []; }
	return ['## Concepts searched',
		'| Concept | Synonyms and variations |',
		'| --- | --- |',
		...review.concepts.map(entry => '| ' + [entry.concept, entry.synonyms.join(', ')].map(cell).join(' | ') + ' |'),
		''];
}

/** The classification map, rendered only when the writer was given one. */
function classificationTable(review: PatentCandidateReview): string[] {
	if (!review.classifications?.length) { return []; }
	return ['## Classifications searched',
		'| Code | Meaning |',
		'| --- | --- |',
		...review.classifications.map(entry => '| ' + [entry.code, entry.meaning].map(cell).join(' | ') + ' |'),
		''];
}

/** The sentence the generated wording list is introduced by, in the working record. */
const WORDING_REVIEW_INTRO = 'The following phrases read as legal conclusions; a candidate review states what each passage discloses and leaves novelty, anticipation, obviousness and teaching-away to counsel. Reword or confirm:';

/** What the mechanical checks did and did not cover; stated once, in the working record. */
const CHECKED_MECHANICALLY = 'Anchor identity, quotation identity and required fields were checked mechanically. Source review notes are model judgments, not verified facts. Semantic entailment, completeness of invention features, and correctness of conclusions were not automatically verified.';

/**
 * The client deliverable: the concepts and classifications the search was built from, the sets that
 * ran, the retrieved documents, the coverage analysis, the stopping rationale and the limitations.
 * The quality machinery — the full search log, the wording review, the second read and the
 * provenance boilerplate — lives in the working record this report's last line names, which also
 * links the detailed tool-outcome and source-metadata evidence.
 *
 * @param variant `invalidity` relabels the statuses for a claim chart and adds the generated
 * reference-roles table. Rendering is byte-identical to a prior-art review when it is omitted.
 */
export function renderCandidateReview(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, workingRecordFileName: string, variant: CandidateReviewVariant = 'prior-art'): string {
	const sources = sourceIndex(snapshot);
	const documents = retrievedDocuments(review, snapshot);
	const uncited = documents.filter(document => !document.cited);
	const automatic = automaticLimitations(review, snapshot, documents);
	// The scope column only exists once a search actually applied a jurisdiction filter; without one
	// there is no confirmed scope to place a document inside or outside of.
	const jurisdictions = searchedJurisdictions(snapshot);
	const scope = (document: RetrievedDocument) => jurisdictions.length
		? [outsideScope(document.publication, jurisdictions) ? `outside searched jurisdictions (${publicationCountry(document.publication)})` : 'in scope']
		: [];
	return [
		...conceptTable(review),
		...classificationTable(review),
		...searchSets(snapshot, documents),
		'## Retrieved documents',
		'Retrieval does not establish eligibility as prior art. This inventory may include post-cutoff background documents. Check each publication date and jurisdiction against the requested scope; unknown dates remain unresolved.',
		'| Publication | Publication date | Title | Text language |' + (jurisdictions.length ? ' Scope |' : ''),
		'| --- | --- | --- | --- |' + (jurisdictions.length ? ' --- |' : ''),
		...documents.map(document => '| ' + [document.publication, document.publicationDate, document.publicationTitle, textLanguage(document), ...scope(document)].map(cell).join(' | ') + ' |'),
		'',
		'## Coverage and remaining search tracks',
		...(review.coverage ?? []).flatMap(row => [
			`### ${cell(row.feature)}`,
			`**${row.kind} · ${row.importance} · ${variant === 'invalidity' ? INVALIDITY_STATUS[row.status] : row.status}${drawingReadingSuffix(row, sources)}**`,
			row.status === 'unresolved' ? 'No supported conclusion is established for this row.' : 'Status is a model assessment of the following evidence, not automated entailment.',
			...(row.sourceAnchors ?? []).flatMap(anchor => {
				const source = sources.get(anchor);
				const evidence = row.evidence?.find(item => item.anchor === anchor);
				return ['', source ? patentCitationLink(anchor, source.reference) : anchor,
					...(evidence ? [quotation(evidence.quote ?? ''),
						`Source review (model judgment): scope/dependency — ${evidence.scope}; qualifiers — ${evidence.qualifiers}; original quantity basis — ${evidence.quantityBasis}.`, ''] : [])];
			}),
			...elementMap(row, sources),
			...rowScopeNotes(row, sources, jurisdictions).flatMap(note => [note, '']),
			`Remaining gap (model judgment): ${row.gap || 'None declared.'}`, '',
		]),
		...(variant === 'invalidity' ? referenceRoleTable(review, sources) : []),
		'', '## Retrieved but not cited in coverage',
		'Retrieved text that no coverage row cites was not reviewed for this report; its content is unknown, not absent.',
		...uncitedDocumentTable(uncited),
		'', '## Search stopping rationale', review.stopReason ?? '',
		'', '## Limitations', ...(review.limitations ?? []).map(value => '- ' + value),
		...(automatic.length ? ['', 'Generated from the execution record, not supplied by the model:', ...automatic.map(value => '- ' + value)] : []),
		'', `Working record: [${workingRecordFileName}](${encodeURIComponent(workingRecordFileName)}) — full search log including queries that could not run, retrieved-but-unread list, wording review, provenance and second read.`,
	].join('\n');
}

/** What the working record says about a second read, whichever way it ended. */
function secondReadSection(review: PatentCandidateReview, secondRead: SecondReadOutcome | undefined, secondReadFileName: string | undefined): string[] {
	if (!secondRead) { return ['## Second read', 'Second read: not run.']; }
	const rows = (review.coverage ?? []).flatMap(row => {
		const notes = secondReadNotes(row, secondRead);
		return notes.length ? [`### ${cell(row.feature)}`, ...notes] : [];
	});
	return ['## Second read', secondReadLimitation(secondRead),
		...(rows.length ? ['', ...rows] : []),
		...(secondReadFileName ? [`[Second-read verdicts](${encodeURIComponent(secondReadFileName)})`] : [])];
}

/**
 * The working record: the internal companion of a client report, written beside it in the workspace.
 * It carries what the deliverable deliberately leaves out — every recorded search including the ones
 * that could not run, the retrieved text nobody read, the wording review, the second read and the
 * provenance of the mechanical checks — so a later session picking up the same matter can see what
 * was already searched and what was deliberately left.
 */
export function renderWorkingRecord(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, reportFileName: string, evidenceFileName: string, secondReadFileName: string | undefined, secondRead?: SecondReadOutcome): string {
	const documents = retrievedDocuments(review, snapshot);
	const wording = candidateWordingReview(review);
	const figures = snapshot.executions.filter(execution => execution.kind === 'figures').length;
	return [
		`# Working record — ${review.subject?.trim() || reportFileName}`,
		'',
		`Companion to [${reportFileName}](${encodeURIComponent(reportFileName)}) — internal search log for a later session picking up the same matter. Not part of the client deliverable.`,
		'',
		'## Search log',
		`${searchExecutions(snapshot).length} recorded search outcomes; ${snapshot.executions.filter(execution => execution.kind === 'details').length} recorded detail outcomes${figures ? `; ${figures} recorded figure outcomes` : ''}. These are tool invocations, not counts of documents reviewed.`,
		'| Outcome | Query actually sent (requested if unknown) | Countries | Total | Returned | Range | Purpose |',
		'| --- | --- | --- | --- | --- | --- | --- |',
		...searchExecutions(snapshot).map(execution => '| ' + [execution.status, execution.effectiveQuery ?? `${execution.query ?? 'unknown'} (effective query unknown)`, execution.countryFilter?.join(', ') ?? 'unknown', String(execution.total ?? 'unknown'), String(execution.returned ?? 'unknown'), execution.range ? `${execution.range.begin}-${execution.range.end}` : execution.requestedRange ? `${execution.requestedRange} (requested)` : 'unknown', searchPurpose(execution) ?? '—'].map(cell).join(' | ') + ' |'),
		'',
		'## Retrieved but not read',
		...uncitedDocumentTable(documents.filter(document => !document.cited)),
		'',
		...secondReadSection(review, secondRead, secondReadFileName),
		'',
		'## Wording review',
		...(wording.length ? [WORDING_REVIEW_INTRO, ...wording.map(value => '- ' + value)] : ['No phrases flagged.']),
		'',
		'## Provenance',
		snapshot.limitation,
		'',
		CHECKED_MECHANICALLY,
		'',
		`[Detailed execution and source metadata](${encodeURIComponent(evidenceFileName)})`,
		'',
	].join('\n');
}
