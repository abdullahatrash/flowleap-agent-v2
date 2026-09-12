/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parsePatentDocumentReference } from '../../patentai/common/patentDocumentReference';
import { SecondReadOutcome, secondReadLimitation, unconfirmedVerdicts } from '../common/patentSecondRead';
import { patentCitationLink } from '../../patentai/vscode-node/patentCitationLink';
import { PatentEvidenceSource, PatentExecutionSnapshot } from '../../patentai/vscode-node/patentExecutionLedger';
import { escape } from '../../../util/vs/base/common/strings';

export interface PatentCandidateReview {
	readonly coverage?: readonly {
		readonly feature: string;
		readonly kind?: 'feature' | 'combination';
		readonly importance: 'essential' | 'optional';
		readonly status: 'supported' | 'partial' | 'unresolved';
		/** Required by the tool schema, but an unresolved row may arrive without it; never dereference unguarded. */
		readonly sourceAnchors?: readonly string[];
		readonly gap: string;
		readonly evidence?: readonly { readonly anchor: string; readonly quote?: string; readonly scope: string; readonly qualifiers: string; readonly quantityBasis: string }[];
		/**
		 * The constituents the feature requires, each with the cited passage that discloses it. A
		 * status is otherwise a one-bit judgment: the element map is what makes it checkable.
		 */
		readonly elements?: readonly { readonly element: string; readonly anchor?: string; readonly disclosedBy?: string }[];
	}[];
	readonly content?: string;
	readonly limitations?: readonly string[];
	readonly stopReason?: string;
	/** Report prose the template renders outside the appendix; checked like every other model-written field. */
	readonly objective?: string;
	readonly searchStrategy?: string;
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
	/** Sections whose text was actually recorded, so an empty retrieval is not reported as available. */
	readonly sectionsWithText: readonly string[];
	/** Claims language, else description language, else `unrecorded`; never inferred from the text. */
	readonly language: string;
	readonly cited: boolean;
}

/** Anchors the model put in coverage, by either sourceAnchors or evidence. */
function citedAnchors(review: PatentCandidateReview): Set<string> {
	return new Set((review.coverage ?? []).flatMap(row => [...(row.sourceAnchors ?? []), ...(row.evidence ?? []).map(item => item.anchor)]));
}

/** Inventory of documents a succeeded detail retrieval brought into the session. */
function retrievedDocuments(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot): readonly RetrievedDocument[] {
	const cited = citedAnchors(review);
	interface DocumentRecord { date?: string; title?: string; sections: Set<string>; languages: Map<string, string>; cited: boolean }
	// The backend echoes ids as `EP0983762.A1` while source references carry `EP0983762A1`; both
	// name one document, so records are keyed on the separator-free form and shown that way.
	const documents = new Map<string, DocumentRecord>();
	const entry = (publication: string): DocumentRecord => {
		const key = publicationKey(publication);
		const existing = documents.get(key);
		if (existing) { return existing; }
		const created: DocumentRecord = { sections: new Set<string>(), languages: new Map<string, string>(), cited: false };
		documents.set(key, created);
		return created;
	};
	for (const execution of snapshot.executions) {
		if (execution.kind !== 'details' || execution.status !== 'succeeded') { continue; }
		for (const publication of execution.publicationIds ?? []) {
			const document = entry(publication);
			document.date ??= execution.publicationDate;
			document.title ??= execution.publicationTitle;
		}
		for (const source of execution.sources ?? []) {
			const document = entry(source.reference.publicationNumber);
			if (source.text?.trim()) { document.sections.add(source.reference.section); }
			if (source.language && !document.languages.has(source.reference.section)) { document.languages.set(source.reference.section, source.language); }
			if (cited.has(source.anchor)) { document.cited = true; }
		}
	}
	return [...documents].map(([publication, document]) => ({
		publication,
		publicationDate: document.date ?? 'Unknown',
		publicationTitle: document.title ?? 'Unknown',
		sectionsWithText: [...document.sections],
		language: document.languages.get('claims') ?? document.languages.get('description') ?? 'unrecorded',
		cited: document.cited,
	}));
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
	const searches = snapshot.executions.filter(execution => execution.kind === 'search');
	const tails = searches.flatMap((execution, index) => execution.status === 'succeeded' && execution.total !== undefined && execution.returned !== undefined && execution.total > execution.returned
		? [`Query ${index + 1} returned ${execution.returned} of ${execution.total} matches; the remaining ${execution.total - execution.returned} were not retrieved.`]
		: []);
	if (tails.length) { lines.push(tails.join(' ')); }
	if (searches.length && !searches.some(execution => CLASSIFICATION_QUERY.test(execution.effectiveQuery ?? execution.query ?? ''))) {
		lines.push('No classification-code (CPC/IPC) query was recorded; the search relied on keywords only.');
	}
	const weak = (review.coverage ?? []).filter(row => row.status !== 'unresolved').flatMap(row => (row.elements ?? [])
		.filter(element => element.disclosedBy !== undefined && element.disclosedBy.trim().length < WEAK_FRAGMENT_LENGTH)
		.map(element => `${row.feature} / ${element.element}`));
	if (weak.length) {
		lines.push(`Element fragments under ${WEAK_FRAGMENT_LENGTH} characters: ${weak.join(', ')}; short fragments prove little.`);
	}
	return lines;
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
	return Boolean(element.anchor?.trim() || element.disclosedBy?.trim());
}

/**
 * Check one element's locators against the recorded text, so "supported" rests on a fragment that
 * actually exists in a cited passage rather than on a passage that merely shares the topic.
 */
function elementDisclosureErrors(row: PatentCoverageRow, element: PatentCoverageElement, sources: Map<string, PatentEvidenceSource>): string[] {
	const errors: string[] = [];
	const anchor = element.anchor?.trim();
	const fragment = element.disclosedBy?.trim();
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
 * Enforce the element map: a supported row discloses every element by cited text, a partial row
 * discloses some and names the rest, and a supported combination rests on a single publication.
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
		if (row.status === 'supported' || claimsDisclosure(element)) { errors.push(...elementDisclosureErrors(row, element, sources)); }
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
export function validateCandidateReview(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, citedText = ''): string[] {
	const errors: string[] = [];
	const sources = sourceIndex(snapshot);
	const anchors = new Set(sources.keys());
	if (review.content?.trim()) { errors.push('For prior-art-report, content must be empty. Put source evidence and gaps in coverage; the writer generates the assessment so a separate narrative or matrix cannot contradict downgraded statuses.'); }
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
		...(review.coverage ?? []).flatMap(row => [
			[`coverage feature for "${row.feature}"`, row.feature] as const,
			[`coverage gap for "${row.feature}"`, row.gap] as const,
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
			return '| ' + [cell(element.element),
				anchor && fragment ? '`' + cell(fragment) + '`' : 'not disclosed in cited text',
				anchor && fragment ? (source ? patentCitationLink(anchor, source.reference) : anchor) : '—'].join(' | ') + ' |';
		}), ''];
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
	if (!unconfirmed.length) { return []; }
	return ['', `Second read (generated, ${secondRead.model}): the following elements were not confirmed by an independent read of the cited text; the row's status is the author's judgment.`,
		...unconfirmed.map(item => `- ${inline(item.element)}: ${item.verdict} — ${inline(item.reason)}`), ''];
}

/**
 * Compact report appendix; detailed tool outcomes live in the linked JSON evidence companion.
 *
 * @param secondRead when present, the report states what an independent read of the cited passages
 * did not confirm, under each affected row and once in Limitations. Rendering is byte-identical to a
 * report written without one when it is omitted.
 */
export function renderCandidateReview(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, evidenceFileName: string, secondRead?: SecondReadOutcome): string {
	const sources = sourceIndex(snapshot);
	const documents = retrievedDocuments(review, snapshot);
	const uncited = documents.filter(document => !document.cited);
	const language = (document: RetrievedDocument) => document.language + (untranslated(document) ? ' (not in English; any reading of it in this report is the model\'s own translation)' : '');
	const automatic = automaticLimitations(review, snapshot, documents);
	const wording = candidateWordingReview(review);
	// The scope column only exists once a search actually applied a jurisdiction filter; without one
	// there is no confirmed scope to place a document inside or outside of.
	const jurisdictions = searchedJurisdictions(snapshot);
	const scope = (document: RetrievedDocument) => jurisdictions.length
		? [outsideScope(document.publication, jurisdictions) ? `outside searched jurisdictions (${publicationCountry(document.publication)})` : 'in scope']
		: [];
	return [
		'## Retrieved documents',
		'Retrieval does not establish eligibility as prior art. This inventory may include post-cutoff background documents. Check each publication date and jurisdiction against the requested scope; unknown dates remain unresolved.',
		'| Publication | Publication date | Title | Text language |' + (jurisdictions.length ? ' Scope |' : ''),
		'| --- | --- | --- | --- |' + (jurisdictions.length ? ' --- |' : ''),
		...documents.map(document => '| ' + [document.publication, document.publicationDate, document.publicationTitle, language(document), ...scope(document)].map(cell).join(' | ') + ' |'),
		'',
		'## Coverage and remaining search tracks',
		...(review.coverage ?? []).flatMap(row => [
			`### ${cell(row.feature)}`,
			`**${row.kind} · ${row.importance} · ${row.status}**`,
			row.status === 'unresolved' ? 'No supported conclusion is established for this row.' : 'Status is a model assessment of the following evidence, not automated entailment.',
			...(row.sourceAnchors ?? []).flatMap(anchor => {
				const source = sources.get(anchor);
				const evidence = row.evidence?.find(item => item.anchor === anchor);
				return ['', source ? patentCitationLink(anchor, source.reference) : anchor,
					...(evidence ? [quotation(evidence.quote ?? ''),
						`Source review (model judgment): scope/dependency — ${evidence.scope}; qualifiers — ${evidence.qualifiers}; original quantity basis — ${evidence.quantityBasis}.`, ''] : [])];
			}),
			...elementMap(row, sources),
			...secondReadNotes(row, secondRead),
			...rowScopeNotes(row, sources, jurisdictions).flatMap(note => [note, '']),
			`Remaining gap (model judgment): ${row.gap || 'None declared.'}`, '',
		]),
		'', '## Retrieved but not cited in coverage',
		'Retrieved text that no coverage row cites was not reviewed for this report; its content is unknown, not absent.',
		...(uncited.length ? [
			'| Publication | Publication date | Title | Sections with text | Text language |',
			'| --- | --- | --- | --- | --- |',
			...uncited.map(document => '| ' + [document.publication, document.publicationDate, document.publicationTitle, document.sectionsWithText.join(', ') || 'none recorded', language(document)].map(cell).join(' | ') + ' |'),
		] : ['Every retrieved document is cited in at least one coverage row.']),
		'', '## Search stopping rationale', review.stopReason ?? '',
		'', '## Limitations', ...(review.limitations ?? []).map(value => '- ' + value),
		...(automatic.length ? ['', 'Generated from the execution record, not supplied by the model:', ...automatic.map(value => '- ' + value), ''] : []),
		...(secondRead ? ['', secondReadLimitation(secondRead), ''] : []),
		snapshot.limitation,
		'Anchor identity, quotation identity and required fields were checked mechanically. Source review notes are model judgments, not verified facts. Semantic entailment, completeness of invention features, and correctness of conclusions were not automatically verified.',
		...(wording.length ? ['', '## Wording review (generated)',
			'The following phrases read as legal conclusions; a candidate review states what each passage discloses and leaves novelty, anticipation, obviousness and teaching-away to counsel. Reword or confirm:',
			...wording.map(value => '- ' + value)] : []),
		'', `## Execution audit`,
		`${snapshot.executions.filter(execution => execution.kind === 'search').length} recorded search outcomes; ${snapshot.executions.filter(execution => execution.kind === 'details').length} recorded detail outcomes. These are tool invocations, not counts of documents reviewed.`,
		'| Outcome | Query actually sent (requested if unknown) | Countries | Total | Returned | Range |',
		'| --- | --- | --- | --- | --- | --- |',
		...snapshot.executions.filter(execution => execution.kind === 'search').map(execution => '| ' + [execution.status, execution.effectiveQuery ?? `${execution.query ?? 'unknown'} (effective query unknown)`, execution.countryFilter?.join(', ') ?? 'unknown', String(execution.total ?? 'unknown'), String(execution.returned ?? 'unknown'), execution.range ? `${execution.range.begin}-${execution.range.end}` : execution.requestedRange ? `${execution.requestedRange} (requested)` : 'unknown'].map(cell).join(' | ') + ' |'),
		`[Detailed execution and source metadata](${encodeURIComponent(evidenceFileName)})`,
	].join('\n');
}
