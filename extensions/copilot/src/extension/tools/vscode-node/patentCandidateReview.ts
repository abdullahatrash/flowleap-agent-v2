/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parsePatentDocumentReference } from '../../patentai/common/patentDocumentReference';
import { PatentExecutionSnapshot } from '../../patentai/vscode-node/patentExecutionLedger';

export interface PatentCandidateReview {
	readonly coverage?: readonly {
		readonly feature: string;
		readonly importance: 'essential' | 'optional';
		readonly status: 'supported' | 'partial' | 'unresolved';
		readonly sourceAnchors: readonly string[];
		readonly gap: string;
	}[];
	readonly limitations?: readonly string[];
	readonly semanticReview?: { readonly observations: readonly string[]; readonly unresolvedConcerns: readonly string[] };
	readonly stopReason?: string;
}

/** Validate explicit review structure and anchor identity, not the truth or entailment of prose. */
export function validateCandidateReview(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, citedText = ''): string[] {
	const errors: string[] = [];
	const anchors = new Set(snapshot.executions.flatMap(execution => execution.sources?.map(source => source.anchor) ?? []));
	// Only application-owned source URLs are checked; external citations and semantic assertions need review.
	for (const match of citedText.matchAll(/[a-z][a-z0-9+.-]*:\/\/flowleap\.patent-ai\/patent\?[^\s)>]+/gi)) {
		const url = new URL(match[0]);
		const reference = parsePatentDocumentReference({ publicationNumber: url.searchParams.get('publication'), section: url.searchParams.get('section'), ...(url.searchParams.has('claim') ? { claimNumber: url.searchParams.get('claim') } : {}) });
		const known = reference && snapshot.executions.some(execution => execution.sources?.some(source => source.reference.publicationNumber === reference.publicationNumber && source.reference.section === reference.section && source.reference.claimNumber === reference.claimNumber));
		if (!known) { errors.push(`Unresolved patent reader citation: ${match[0]}. Retrieve the exact section/claim or remove the unsupported citation.`); }
	}
	if (!review.coverage?.length) { errors.push('Supply coverage for essential features and their combination, including unresolved tracks.'); }
	for (const row of review.coverage ?? []) {
		if (!row.feature?.trim() || !['essential', 'optional'].includes(row.importance) || !['supported', 'partial', 'unresolved'].includes(row.status)) { errors.push('Every coverage row needs a feature, importance, and valid status.'); }
		if (row.status !== 'unresolved' && !row.sourceAnchors?.length) { errors.push(`Coverage for "${row.feature}" needs known source anchors or unresolved status.`); }
		for (const anchor of row.sourceAnchors ?? []) { if (!anchors.has(anchor)) { errors.push(`Unknown source anchor: ${anchor}. Retrieve this source in the current session or mark the feature unresolved without this anchor.`); } }
		if (row.status !== 'supported' && !row.gap?.trim()) { errors.push(`Describe the remaining gap for "${row.feature}".`); }
	}
	if (!review.coverage?.some(row => row.importance === 'essential')) { errors.push('Identify at least one essential feature or combination.'); }
	if (!review.limitations?.some(value => value.trim())) { errors.push('Supply the search and evidence limitations.'); }
	if (!review.stopReason?.trim()) { errors.push('Supply stopReason: explain synthesis, remaining gaps, or the user-requested boundary.'); }
	if (!review.semanticReview?.observations?.some(value => value.trim()) || !Array.isArray(review.semanticReview?.unresolvedConcerns)) {
		errors.push('Complete a source-grounded semantic review: observations on scope, dependent claims, qualifiers, units/denominators and absence statements; include unresolvedConcerns (an empty array is allowed). This is a model declaration, not automated semantic verification.');
	}
	return errors;
}

function cell(value: string): string { return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

/** Compact report appendix; detailed tool outcomes live in the linked JSON evidence companion. */
export function renderCandidateReview(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, evidenceFileName: string): string {
	return [
		'## Coverage and remaining search tracks',
		'| Feature / combination | Importance | Status | Source anchors | Gap |',
		'| --- | --- | --- | --- | --- |',
		...(review.coverage ?? []).map(row => '| ' + [row.feature, row.importance, row.status, row.sourceAnchors.join(', '), row.gap].map(cell).join(' | ') + ' |'),
		'', '## Search stopping rationale', review.stopReason ?? '',
		'', '## Limitations', ...(review.limitations ?? []).map(value => '- ' + value),
		snapshot.limitation,
		'', '## Source-grounded semantic review (model declaration)',
		...(review.semanticReview?.observations ?? []).map(value => '- ' + value),
		'Unresolved concerns:', ...(review.semanticReview?.unresolvedConcerns.length ? review.semanticReview.unresolvedConcerns.map(value => '- ' + value) : ['None declared by the model.']),
		'Anchor identity and required fields were checked mechanically. Semantic entailment, completeness of invention features, and correctness of conclusions were not automatically verified.',
		'', `## Execution audit`,
		`${snapshot.executions.filter(execution => execution.kind === 'search').length} recorded search outcomes; ${snapshot.executions.filter(execution => execution.kind === 'details').length} recorded detail outcomes. These are tool invocations, not counts of documents reviewed.`,
		'| Outcome | Query actually sent (requested if unknown) | Countries | Total | Returned | Range |',
		'| --- | --- | --- | --- | --- | --- |',
		...snapshot.executions.filter(execution => execution.kind === 'search').map(execution => '| ' + [execution.status, execution.effectiveQuery ?? `${execution.query ?? 'unknown'} (effective query unknown)`, execution.countryFilter?.join(', ') ?? 'unknown', String(execution.total ?? 'unknown'), String(execution.returned ?? 'unknown'), execution.range ? `${execution.range.begin}-${execution.range.end}` : execution.requestedRange ? `${execution.requestedRange} (requested)` : 'unknown'].map(cell).join(' | ') + ' |'),
		`[Detailed execution and source metadata](${encodeURIComponent(evidenceFileName)})`,
	].join('\n');
}
