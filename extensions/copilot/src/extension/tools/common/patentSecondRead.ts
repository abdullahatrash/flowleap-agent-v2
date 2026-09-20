/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Second read of a saved prior-art report: a separate model call, per coverage row, that judges
 * whether each quoted source passage actually discloses the element it was cited for.
 *
 * The module is deliberately free of `vscode` and of the extension's service graph so the offline
 * replay script can run the identical request building and prompt over reports already on disk.
 * Structural types stand in for the review and the ledger snapshot; the real
 * `PatentCandidateReview` and `PatentExecutionSnapshot` are assignable to them.
 */

/** One element of a coverage row: what the feature requires, and where the report says it is disclosed. */
export interface SecondReadElement {
	readonly element: string;
	readonly anchor?: string;
	readonly disclosedBy?: string;
	/** `figure` marks an element that rests on a drawing; the judge reads text, so it is not judged. */
	readonly basis?: 'text' | 'figure';
	/** The model's reading of the drawing. Carried for completeness; the judge is never shown it. */
	readonly reading?: string;
}

/** A coverage row as far as the second read is concerned. */
export interface SecondReadRow {
	readonly feature: string;
	readonly status: string;
	readonly elements?: readonly SecondReadElement[];
}

/** The saved review, reduced to the coverage the second read judges. */
export interface SecondReadReview {
	readonly coverage?: readonly SecondReadRow[];
}

/** A recorded source passage, keyed by the anchor the report cites. */
export interface SecondReadSource {
	readonly anchor: string;
	readonly text?: string;
}

/** The execution record the passages are recovered from. */
export interface SecondReadSnapshot {
	readonly executions: readonly { readonly sources?: readonly SecondReadSource[] }[];
}

/** One judge call: a single coverage row with the recorded text behind each of its elements. */
export interface SecondReadRequest {
	readonly feature: string;
	readonly status: string;
	readonly elements: readonly {
		readonly element: string;
		readonly anchor?: string;
		readonly disclosedBy?: string;
		/** The full recorded text of the anchor, windowed to {@link PASSAGE_WINDOW} around the fragment. */
		readonly passage?: string;
	}[];
}

export interface SecondReadVerdict {
	readonly element: string;
	readonly verdict: 'agree' | 'disagree' | 'unclear';
	readonly reason: string;
}

/** One judged row, or the raw text of a reply that could not be parsed. */
export interface SecondReadResult {
	readonly feature: string;
	readonly status: string;
	readonly verdicts?: readonly SecondReadVerdict[];
	readonly unparsed?: string;
}

export interface SecondReadSummary {
	readonly elements: number;
	readonly agree: number;
	readonly disagree: number;
	readonly unclear: number;
	readonly unparsed: number;
	/** Elements left out of the judge request because they rest on a drawing; absent when there are none. */
	readonly notJudged?: number;
}

/**
 * What one second read produced: the judged rows, or the reason it did not run. The report renderer,
 * the verdict file and the tool result all read this one value, so they cannot disagree about what
 * happened.
 */
export type SecondReadOutcome =
	| { readonly kind: 'judged'; readonly model: string; readonly rows: readonly SecondReadResult[]; readonly summary: SecondReadSummary }
	| { readonly kind: 'skipped'; readonly reason: string };

/** Only a row that claims disclosure can be second-read; an unresolved row claims none. */
const JUDGED_STATUSES: readonly string[] = ['supported', 'partial'];

/** Characters of recorded text shown to the judge for one element. */
export const PASSAGE_WINDOW = 6000;

const VERDICTS: readonly string[] = ['agree', 'disagree', 'unclear'];

/**
 * Locate the cited fragment inside the recorded text. The report's own check normalizes whitespace
 * before comparing, so a fragment copied from a line-wrapped passage need not match literally.
 */
function fragmentIndex(text: string, fragment: string): number {
	const direct = text.toLowerCase().indexOf(fragment.toLowerCase());
	if (direct >= 0) { return direct; }
	const words = fragment.trim().split(/\s+/).filter(Boolean).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	if (!words.length) { return -1; }
	return text.match(new RegExp(words.join('\\s+'), 'i'))?.index ?? -1;
}

/**
 * The window of recorded text shown to the judge. A long passage is cut to {@link PASSAGE_WINDOW}
 * characters centred on the cited fragment, so the text the verdict rests on stays inside it.
 */
function passageWindow(text: string, fragment: string | undefined): string {
	if (text.length <= PASSAGE_WINDOW) { return text; }
	const trimmed = fragment?.trim();
	const index = trimmed ? fragmentIndex(text, trimmed) : -1;
	if (index < 0) { return text.slice(0, PASSAGE_WINDOW); }
	const lead = Math.floor(Math.max(0, PASSAGE_WINDOW - (trimmed?.length ?? 0)) / 2);
	const start = Math.max(0, Math.min(index - lead, text.length - PASSAGE_WINDOW));
	return text.slice(start, start + PASSAGE_WINDOW);
}

/** An element the judge cannot check: a drawing has no text for an independent read to weigh. */
function restsOnDrawing(element: SecondReadElement): boolean {
	return element.basis === 'figure';
}

/**
 * The elements a second read leaves to the report because they rest on a drawing. They are counted
 * so the diagnostic states what it did not judge instead of quietly judging fewer elements.
 */
export function notJudgedFigureElements(review: SecondReadReview): number {
	return (review.coverage ?? [])
		.filter(row => JUDGED_STATUSES.includes(row.status))
		.reduce((total, row) => total + (row.elements ?? []).filter(restsOnDrawing).length, 0);
}

/** One request per coverage row that claims disclosure and lists the elements to check. */
export function buildSecondReadRequests(review: SecondReadReview, snapshot: SecondReadSnapshot): SecondReadRequest[] {
	const sources = new Map(snapshot.executions.flatMap(execution => execution.sources ?? []).map(source => [source.anchor, source]));
	return (review.coverage ?? [])
		.filter(row => JUDGED_STATUSES.includes(row.status) && row.elements?.length)
		.map(row => ({
			feature: row.feature,
			status: row.status,
			elements: (row.elements ?? []).filter(element => !restsOnDrawing(element)).map(element => {
				const anchor = element.anchor?.trim();
				const fragment = element.disclosedBy?.trim();
				const text = anchor ? sources.get(anchor)?.text : undefined;
				return {
					element: element.element,
					...(anchor ? { anchor } : {}),
					...(fragment ? { disclosedBy: fragment } : {}),
					...(text ? { passage: passageWindow(text, fragment) } : {}),
				};
			}),
		}))
		// A row whose every element rests on a drawing has nothing for the judge to read.
		.filter(request => request.elements.length > 0);
}

/**
 * The judge prompt for one row. It carries its own instructions because the judge sees no
 * conversation history: only the feature, its elements, and the recorded passages behind them.
 */
export function secondReadPrompt(request: SecondReadRequest): string {
	const elements = request.elements.map((element, index) => {
		const lines = [`ELEMENT ${index + 1}: ${element.element}`];
		if (element.passage) {
			if (element.disclosedBy) { lines.push(`CITED FRAGMENT: ${element.disclosedBy}`); }
			lines.push(`SOURCE PASSAGE (${element.anchor ?? 'unnamed source'}):`, '"""', element.passage, '"""');
		} else if (element.disclosedBy || element.anchor) {
			lines.push(`CITED FRAGMENT: ${element.disclosedBy ?? '(none)'}`, `SOURCE PASSAGE (${element.anchor ?? 'unnamed source'}): NOT AVAILABLE — the recorded text for this source was not kept.`);
		} else {
			lines.push('NO PASSAGE CITED — the report states this element is not disclosed by the cited text.');
		}
		return lines.join('\n');
	});
	return [
		'You are a patent examiner checking one coverage row of a prior-art report. You see only what is printed below: the feature, the elements it was broken into, and the source passages a previous model cited for them. You have no other context, no conversation history and no access to the documents; judge the printed text alone.',
		'',
		'Judge DISCLOSURE ONLY. For each element that has a source passage, decide whether that passage discloses the element AS WRITTEN. A passage that discloses only a broader genus, a merely similar structure, an adjacent function, or a different arrangement of the same parts does NOT disclose the element. Do not judge novelty, obviousness, inventive step, patentability or the report\'s overall conclusion.',
		'',
		'An element printed as NO PASSAGE CITED was reported as not disclosed by the cited text. For those, judge whether that reading is consistent with the passages printed for the other elements of this row: agree when nothing in the printed text discloses it, disagree when one of the printed passages does disclose it.',
		'',
		'Verdicts:',
		'- "agree": the element is disclosed as written by its passage; or, for an element with no passage, the printed text indeed does not disclose it.',
		'- "disagree": the passage does not disclose the element as written; or, for an element with no passage, one of the printed passages does disclose it.',
		'- "unclear": the printed text is too incomplete, ambiguous or truncated to decide.',
		'',
		'Answer with JSON only. No prose, no code fence, one entry per element below, in the same order, copying each element text exactly:',
		'{"verdicts":[{"element":"...","verdict":"agree|disagree|unclear","reason":"one sentence"}]}',
		'',
		`FEATURE: ${request.feature}`,
		`STATUS CLAIMED BY THE REPORT: ${request.status}`,
		'',
		...elements.flatMap(element => [element, '']),
	].join('\n');
}

/** True when the value has the shape of a verdict entry; the judge is a model, not a schema. */
function isVerdict(value: unknown): value is SecondReadVerdict {
	if (!value || typeof value !== 'object') { return false; }
	const entry = value as Record<string, unknown>;
	return typeof entry.element === 'string' && typeof entry.verdict === 'string' && VERDICTS.includes(entry.verdict) && typeof entry.reason === 'string';
}

/**
 * Recover the verdicts from a model reply, tolerating a code fence or prose around the JSON.
 * Returns undefined when nothing of the expected shape can be recovered, so an unparsed reply is
 * recorded as such instead of being silently counted as agreement.
 */
export function parseSecondReadVerdicts(text: string): SecondReadVerdict[] | undefined {
	const fenced = text.replace(/```(?:json)?/gi, '');
	const start = fenced.indexOf('{');
	const end = fenced.lastIndexOf('}');
	if (start < 0 || end <= start) { return undefined; }
	let parsed: unknown;
	try {
		parsed = JSON.parse(fenced.slice(start, end + 1));
	} catch {
		return undefined;
	}
	const verdicts = (parsed as { verdicts?: unknown })?.verdicts;
	if (!Array.isArray(verdicts) || !verdicts.length || !verdicts.every(isVerdict)) { return undefined; }
	return verdicts.map(({ element, verdict, reason }) => ({ element, verdict, reason }));
}

/**
 * Counts for the one-line diagnostic: elements judged, how the judge split over them, and the
 * elements that were never sent because they rest on a drawing.
 */
export function summarizeSecondRead(results: readonly SecondReadResult[], notJudged = 0): SecondReadSummary {
	const verdicts = results.flatMap(result => result.verdicts ?? []);
	return {
		elements: verdicts.length,
		agree: verdicts.filter(verdict => verdict.verdict === 'agree').length,
		disagree: verdicts.filter(verdict => verdict.verdict === 'disagree').length,
		unclear: verdicts.filter(verdict => verdict.verdict === 'unclear').length,
		unparsed: results.filter(result => result.unparsed !== undefined).length,
		...(notJudged ? { notJudged } : {}),
	};
}

/** An element the judge did not confirm, with the coverage row it belongs to. */
export interface SecondReadUnconfirmed {
	readonly feature: string;
	readonly element: string;
	readonly verdict: 'disagree' | 'unclear';
	readonly reason: string;
}

/**
 * Everything the judge did not confirm, in report order. A disagreement and an unclear passage are
 * both reasons a reader should look again; only an `agree` is a confirmation.
 */
export function unconfirmedVerdicts(results: readonly SecondReadResult[]): SecondReadUnconfirmed[] {
	return results.flatMap(result => (result.verdicts ?? [])
		.filter((verdict): verdict is SecondReadVerdict & { verdict: 'disagree' | 'unclear' } => verdict.verdict !== 'agree')
		.map(verdict => ({ feature: result.feature, element: verdict.element, verdict: verdict.verdict, reason: verdict.reason })));
}

/**
 * The line the report states about its own second read, inside Limitations. It is generated from
 * the judge's own counts, so a report cannot carry a second read the reader is not told about.
 */
export function secondReadLimitation(outcome: SecondReadOutcome): string {
	if (outcome.kind === 'skipped') { return `Second read: skipped (${outcome.reason}).`; }
	const { elements, disagree, unclear, unparsed, notJudged } = outcome.summary;
	return `Second read by ${outcome.model}: ${elements} elements judged, ${disagree} not confirmed, ${unclear} unclear, ${unparsed} unparsed${notJudged ? `, ${notJudged} not judged (figure)` : ''}.`;
}
