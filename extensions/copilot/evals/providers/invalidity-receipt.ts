/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../src/util/vs/base/common/uri';
import { priorArtReportReceipt } from '../../src/extension/tools/node/priorArtReportCompletion';
import type { PatentCandidateReview } from '../../src/extension/tools/vscode-node/patentCandidateReview';
import { fallbackCoverage, fallbacksNotCovered } from '../../src/extension/tools/vscode-node/patentFallbackLadder';

/** A mock `write_patent_results` whose receipt is computed from the save's own arguments. */
export interface InvalidityReceiptMock {
	/** Workspace-relative path the mock reports the chart saved at. */
	readonly reportPath: string;
	/** Text between the "Successfully wrote" line and the receipt line (the writer's summary contract). */
	readonly preamble: string;
}

/**
 * The tool result the structured writer returns for an invalidity chart, with the Fallback Coverage
 * counts the real writer states: `fallbacksNotCovered` and `notCovered` from the fallback rows marked
 * `unresolved` (the writer's own `fallbackCoverage`), `rounds` from the save's `rounds`. The receipt
 * line is the writer's own `priorArtReportReceipt`; the digests hash the saved arguments, since a
 * mock save writes no file.
 */
export function invalidityReceiptBody(mock: InvalidityReceiptMock, args: Record<string, unknown>): string {
	// The arguments are the model's JSON; the writer's coverage reader takes only the fields it needs.
	const review = args as PatentCandidateReview;
	const coverage = fallbackCoverage(review, { kind: 'missing' });
	const fallbacks = {
		fallbacksNotCovered: fallbacksNotCovered(coverage),
		rounds: Array.isArray(review.rounds) ? review.rounds.length : 0,
		notCovered: coverage.flatMap(claim => claim.notCovered),
	};
	const stem = mock.reportPath.replace(/\.md$/, '');
	const report = URI.file(`/workspace/${mock.reportPath}`);
	const evidence = URI.file(`/workspace/${stem}.evidence.json`);
	const document = JSON.stringify(args);
	return `Successfully wrote patent results to ${mock.reportPath}\n${mock.preamble}\n${priorArtReportReceipt(report, document, evidence, document, fallbacks)}\nWorking record: ${stem}.working-record.md`;
}
