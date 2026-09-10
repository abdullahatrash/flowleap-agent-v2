/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parsePatentDocumentReference } from '../../patentai/common/patentDocumentReference';
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
	}[];
	readonly content?: string;
	readonly limitations?: readonly string[];
	readonly stopReason?: string;
}

/** Anchor to recorded source, the single index every pass over a snapshot shares. */
function sourceIndex(snapshot: PatentExecutionSnapshot): Map<string, PatentEvidenceSource> {
	return new Map(snapshot.executions.flatMap(execution => execution.sources ?? []).map(source => [source.anchor, source]));
}

/** Numbered claims can be copied from the ledger instead of transcribed by the model. */
export function materializeCandidateReview<T extends PatentCandidateReview>(review: T, snapshot: PatentExecutionSnapshot): T {
	const sources = sourceIndex(snapshot);
	return { ...review, coverage: review.coverage?.map(row => ({ ...row, evidence: row.evidence?.map(evidence => {
		const source = sources.get(evidence.anchor);
		return { ...evidence, quote: evidence.quote ?? (source?.reference.claimNumber ? source.text : undefined) };
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
			if (row.status !== 'unresolved' && !evidence) { errors.push(`Supply an exact quotation and source review for ${anchor}.`); }
			if (evidence) {
				const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
				if (!evidence.quote?.trim() || !source?.text || !normalize(source.text).includes(normalize(evidence.quote))) { errors.push(`Quotation for ${anchor} must match recorded text. Recover it with evidenceLookup.anchor; older records without text require one detail retrieval.`); }
				if (source?.reference.claimNumber && source.text && normalize(evidence.quote ?? '') !== normalize(source.text)) { errors.push(`Quote the complete claim for ${anchor}, including dependency language, qualifiers and every constituent; do not extract only a numeric range.`); }
				if (![evidence.scope, evidence.qualifiers, evidence.quantityBasis].every(value => value?.trim())) { errors.push(`Review scope/dependency, qualifiers and original quantity basis for ${anchor}. Keep original units and all constituents; do not substitute an unverified percentage conversion.`); }
			}
		}
		if (row.evidence?.some(item => !(row.sourceAnchors ?? []).includes(item.anchor))) { errors.push(`Evidence for "${row.feature}" must use that row's sourceAnchors.`); }
		if (row.status !== 'supported' && !row.gap?.trim()) { errors.push(`Describe the remaining gap for "${row.feature}".`); }
	}
	if (!review.coverage?.some(row => row.importance === 'essential')) { errors.push('Identify at least one essential feature or combination.'); }
	if (!review.limitations?.some(value => value.trim())) { errors.push('Supply the search and evidence limitations.'); }
	if (!review.stopReason?.trim()) { errors.push('Supply stopReason: explain synthesis, remaining gaps, or the user-requested boundary.'); }
	if (!review.coverage?.some(row => row.kind === 'combination' && row.importance === 'essential')) { errors.push('Include an explicit essential combination row; it may honestly remain unresolved.'); }
	return errors;
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

/** Compact report appendix; detailed tool outcomes live in the linked JSON evidence companion. */
export function renderCandidateReview(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, evidenceFileName: string): string {
	const sources = sourceIndex(snapshot);
	const candidates = new Map(snapshot.executions.filter(execution => execution.kind === 'details' && execution.status === 'succeeded').flatMap(execution => (execution.publicationIds ?? []).map(publication => [publication, execution] as const)));
	return [
		'## Retrieved documents',
		'Retrieval does not establish eligibility as prior art. This inventory may include post-cutoff background documents. Check each publication date and jurisdiction against the requested scope; unknown dates remain unresolved.',
		'| Publication | Publication date | Title |',
		'| --- | --- | --- |',
		...[...candidates].map(([publication, execution]) => '| ' + [publication, execution.publicationDate ?? 'Unknown', execution.publicationTitle ?? 'Unknown'].map(cell).join(' | ') + ' |'),
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
			`Remaining gap (model judgment): ${row.gap || 'None declared.'}`, '',
		]),
		'', '## Search stopping rationale', review.stopReason ?? '',
		'', '## Limitations', ...(review.limitations ?? []).map(value => '- ' + value),
		snapshot.limitation,
		'Anchor identity, quotation identity and required fields were checked mechanically. Source review notes are model judgments, not verified facts. Semantic entailment, completeness of invention features, and correctness of conclusions were not automatically verified.',
		'', `## Execution audit`,
		`${snapshot.executions.filter(execution => execution.kind === 'search').length} recorded search outcomes; ${snapshot.executions.filter(execution => execution.kind === 'details').length} recorded detail outcomes. These are tool invocations, not counts of documents reviewed.`,
		'| Outcome | Query actually sent (requested if unknown) | Countries | Total | Returned | Range |',
		'| --- | --- | --- | --- | --- | --- |',
		...snapshot.executions.filter(execution => execution.kind === 'search').map(execution => '| ' + [execution.status, execution.effectiveQuery ?? `${execution.query ?? 'unknown'} (effective query unknown)`, execution.countryFilter?.join(', ') ?? 'unknown', String(execution.total ?? 'unknown'), String(execution.returned ?? 'unknown'), execution.range ? `${execution.range.begin}-${execution.range.end}` : execution.requestedRange ? `${execution.requestedRange} (requested)` : 'unknown'].map(cell).join(' | ') + ' |'),
		`[Detailed execution and source metadata](${encodeURIComponent(evidenceFileName)})`,
	].join('\n');
}
