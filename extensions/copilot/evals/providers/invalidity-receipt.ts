/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../src/util/vs/base/common/uri';
import { priorArtReportReceipt } from '../../src/extension/tools/node/priorArtReportCompletion';
import { evidenceSourceIndex } from '../../src/extension/patentai/vscode-node/patentExecutionLedger';
import type { PatentCandidateReview } from '../../src/extension/tools/vscode-node/patentCandidateReview';
import { fallbackCoverage, fallbacksNotCovered, rowOpenPoints, webSourceOpenPoints } from '../../src/extension/tools/vscode-node/patentFallbackLadder';
import { webPatentEvidence } from '../../src/extension/tools/vscode-node/patentWebEvidence';

/** A fetched patent page the mock session recorded as web evidence, exactly as `fetch_webpage` does (#750). */
export interface WebPageMock {
	/** The page URL the fixture's `fetch_webpage` rule answers. */
	readonly url: string;
	/** The page text, the same text that rule returns, so the recorded anchors are the ones the model read. */
	readonly content: string;
}

/** A mock `write_patent_results` whose receipt is computed from the save's own arguments. */
export interface InvalidityReceiptMock {
	/** Workspace-relative path the mock reports the chart saved at. */
	readonly reportPath: string;
	/** Text between the "Successfully wrote" line and the receipt line (the writer's summary contract). */
	readonly preamble: string;
	/** Patent pages the session fetched, so the receipt lists `source-<pub>` for a row that rests on one as the writer does. */
	readonly webPages?: readonly WebPageMock[];
}

/**
 * The tool result the structured writer returns for an invalidity chart, with the Fallback Coverage
 * counts the real writer states: `fallbacksNotCovered` and `notCovered` from the fallback rows marked
 * `unresolved` (the writer's own `fallbackCoverage`), `rounds` from the save's `rounds`, and the open
 * points the save's own rows give (the writer's own `rowOpenPoints`: rungs partly or not covered,
 * elements not found), then one `source-<pub>` point per fetched patent page a row rests on (the
 * writer's own `webSourceOpenPoints` over the sources `webPatentEvidence` records). A mock has no
 * ledger, so the open points only the record gives (scope, date, drawing, failed search) are absent.
 * The receipt is the writer's own `priorArtReportReceipt`; the digests hash the saved arguments,
 * since a mock save writes no file.
 */
export function invalidityReceiptBody(mock: InvalidityReceiptMock, args: Record<string, unknown>): string {
	// The arguments are the model's JSON; the writer's coverage reader takes only the fields it needs.
	const review = args as PatentCandidateReview;
	const coverage = fallbackCoverage(review, { kind: 'missing' });
	const webSources = evidenceSourceIndex((mock.webPages ?? []).flatMap(page => webPatentEvidence(page.url, page.content)?.sources ?? []));
	const fallbacks = {
		fallbacksNotCovered: fallbacksNotCovered(coverage),
		rounds: Array.isArray(review.rounds) ? review.rounds.length : 0,
		notCovered: coverage.flatMap(claim => claim.notCovered),
		openPoints: [...rowOpenPoints(review), ...webSourceOpenPoints(review, webSources)],
		criticalDate: typeof review.criticalDate === 'string' && review.criticalDate.trim() ? review.criticalDate.trim() : undefined,
	};
	const stem = mock.reportPath.replace(/\.md$/, '');
	const report = URI.file(`/workspace/${mock.reportPath}`);
	const evidence = URI.file(`/workspace/${stem}.evidence.json`);
	const document = JSON.stringify(args);
	return `Successfully wrote patent results to ${mock.reportPath}\n${mock.preamble}\n${priorArtReportReceipt(report, document, evidence, document, fallbacks)}\nWorking record: ${stem}.working-record.md`;
}
