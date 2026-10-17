/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelToolResult } from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { sha256Hex } from '../../../util/node/crypto';
import { escapeRegExpCharacters } from '../../../util/vs/base/common/strings';
import { URI } from '../../../util/vs/base/common/uri';
import { IToolCallRound } from '../../prompt/common/intents';
import { ToolName } from '../common/toolNames';

interface ReportReceipt {
	readonly reportUri: string;
	readonly reportDigest: string;
	readonly evidenceUri: string;
	readonly evidenceDigest: string;
}

/**
 * One open point of a saved invalidity chart (PRD 0024 C4): a short id the Round Report and a Search
 * Round's `answers` name, and one line that says what is open. Computed by the writer from the record.
 */
export interface ReceiptOpenPoint {
	readonly id: string;
	readonly text: string;
}

/**
 * Fallback Coverage of a saved invalidity chart, as its receipt states it (PRD 0024 C3): how many
 * fallbacks the cited art does not cover, how many Search Rounds the chart records, and which
 * fallbacks are not covered (claim numbers, or a description fallback's feature). The receipt also
 * lists the chart's open points (C4), in the order the Round Report numbers them.
 */
export interface ReceiptFallbacks {
	readonly fallbacksNotCovered: number;
	readonly rounds: number;
	readonly notCovered: readonly string[];
	readonly openPoints: readonly ReceiptOpenPoint[];
	/** The chart's structured critical date; absent when the chart gave none, so the date check was skipped. */
	readonly criticalDate?: string;
}

interface ParsedReportReceipt extends ReportReceipt {
	/** The index of the round that holds the writer call, within its turn. */
	readonly roundIndex: number;
	readonly callIndex: number;
	/** The ids of the open points the receipt lists; absent on older receipts and on other templates. */
	readonly openPoints?: readonly string[];
}

const receiptPrefix = 'Prior-art artifact receipt: ';
const fallbackFields = ' fallbacksNotCovered=';
const openPointsHeader = 'Open points: ';
const openPointLine = /^Open point \[(?<id>[^\]\s]+)\]: /;

/** The words that mark the Round Report nudge in a round's recorded hook context. */
const roundReportNudgeMarker = 'this turn ends without a Round Report';

/** The prompt line that closes every Round Report (ADR 0016 amendment, decision 7). */
export const ROUND_REPORT_PROMPT = 'Reply with the numbers to run, \'all\', or your own steer.';

/**
 * Bind the report and its evidence revision to the bytes the structured writer actually saved. An
 * invalidity chart's receipt also states its Fallback Coverage counts and, one line each, its open
 * points, so the completion guard reads no file to decide on a Round Report.
 */
export function priorArtReportReceipt(report: URI, document: string, evidence: URI, snapshot: string, fallbacks?: ReceiptFallbacks): string {
	const line = receiptPrefix + JSON.stringify({ reportUri: report.toString(), reportDigest: sha256Hex(document), evidenceUri: evidence.toString(), evidenceDigest: sha256Hex(snapshot) } satisfies ReportReceipt);
	if (!fallbacks) { return line; }
	// One line each: a description fallback's feature may hold line breaks, which would split a line.
	const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
	const notCovered = fallbacks.notCovered.map(oneLine).filter(Boolean).join(',');
	const criticalDate = fallbacks.criticalDate ? `Critical date: ${fallbacks.criticalDate}.` : 'Critical date: not given (no criticalDate), so the publication dates of the cited documents were not checked.';
	const points = fallbacks.openPoints;
	const header = points.length
		? `${openPointsHeader}${points.length}. ${criticalDate} Write the Round Report now: this receipt, then one numbered question per open point in this order, each with its id and your recommended next step, then the line "${ROUND_REPORT_PROMPT}" Then end the turn; run a Search Round only on the expert's answer.`
		: `${openPointsHeader}none. ${criticalDate}`;
	return [`${line}${fallbackFields}${fallbacks.fallbacksNotCovered} rounds=${fallbacks.rounds} notCovered=${notCovered}`, header, ...points.map(point => `Open point [${point.id}]: ${oneLine(point.text)}`)].join('\n');
}


/** Conservative routing for explicit English prior-art deliverable requests, not every patent question. */
export function requestsPriorArtReport(message: string): boolean {
	return (/\bprior[\s-]+art\b/i.test(message) && /\b(report|review|save|write|output)\b/i.test(message)) || requestsInvalidityChart(message) || requestsFindBetter(message);
}

/** A Find Better run is the same structured report, two-sided, so it is finalized on the same path. */
function requestsFindBetter(message: string): boolean {
	return /\bfind[\s-]+better\b/i.test(message);
}

/**
 * An invalidity deliverable is the same structured report with the challenged patent's elements as
 * its rows, so it is finalized and checked on the same path.
 */
function requestsInvalidityChart(message: string): boolean {
	return /\binvalidity\b/i.test(message) && /\b(report|chart|analysis|case)\b/i.test(message);
}

/**
 * A writer call that finalizes a structured report: `prior-art-report` and `find-better-report`
 * always, and `invalidity-claim-chart` when it carries the coverage rows the writer validates and
 * renders.
 */
function finalizesStructuredReport(call: IToolCallRound['toolCalls'][number]): boolean {
	if (call.name !== ToolName.WritePatentResults) { return false; }
	try {
		const value: { template?: unknown; coverage?: unknown } = JSON.parse(call.arguments);
		return value.template === 'prior-art-report' || value.template === 'find-better-report' || (value.template === 'invalidity-claim-chart' && Array.isArray(value.coverage) && value.coverage.length > 0);
	} catch { return false; }
}

export interface ReportCompletionTurn {
	readonly message: string;
	readonly rounds: readonly IToolCallRound[];
	readonly results: Readonly<Record<string, LanguageModelToolResult>>;
}

/** Generic writes are allowed as drafts, but only a current structured-writer receipt finalizes research. */
export async function checkPriorArtReportCompletion(history: readonly ReportCompletionTurn[], current: ReportCompletionTurn, files: IFileSystemService): Promise<string | undefined> {
	const currentCalls = current.rounds.flatMap(round => round.toolCalls);
	const hasResearch = currentCalls.some(isRetrieval);
	const turns = [...history, current];
	const requestIndex = turns.map(turn => requestsPriorArtReport(turn.message)).lastIndexOf(true);
	const reportRequest = turns[requestIndex];
	const activeHistory = requestIndex < 0 ? [] : turns.slice(requestIndex, -1);
	const currentReceipts = receipts(current);
	const priorReceipts = activeHistory.flatMap(turn => receipts(turn));
	const target = reportRequest && requestedReportPath(reportRequest.message);
	const writingReport = currentCalls.some(finalizesStructuredReport);
	const mentionsTarget = !!target && currentCalls.some(call => mentionsPath(call, target));
	const continuing = /^\s*continue\b/i.test(current.message) || /\b(revise|update|correct)\b.*\b(report|review)\b/i.test(current.message);
	const pendingResearch = !priorReceipts.length && activeHistory.some(turn => turn.rounds.some(round => round.toolCalls.some(isRetrieval)));
	const genericWrite = currentCalls.some(call => [ToolName.CreateFile, ToolName.EditFile, ToolName.ApplyPatch, ToolName.ReplaceString, ToolName.MultiReplaceString, ToolName.CoreRunInTerminal, ToolName.CoreSendToTerminal].some(name => name === call.name));
	const currentReportRequest = requestsPriorArtReport(current.message);
	const required = writingReport || (currentReportRequest && (hasResearch || genericWrite)) || (!!reportRequest && hasResearch && (continuing || !!mentionsTarget)) || (pendingResearch && (hasResearch || continuing || !!mentionsTarget));
	// The deliverable the user asked for decides which structured template finalizes it; both take the
	// same empty content and evidence-backed coverage.
	const requested = reportRequest?.message ?? current.message;
	const findBetter = requestsFindBetter(requested);
	const invalidity = !findBetter && requestsInvalidityChart(requested);
	const deliverable = findBetter ? 'Find Better report' : invalidity ? 'invalidity chart' : 'prior-art report';
	const structuredTemplate = findBetter ? 'find-better-report' : invalidity ? 'invalidity-claim-chart' : 'prior-art-report';
	if (required && !currentReceipts.length) {
		return `The requested ${deliverable} has no successful structured finalization in this turn. Generic file writes and free-form writer calls are unvalidated drafts. Save the requested report with write_patent_results, template="${structuredTemplate}", empty content and the evidence-backed coverage fields. An honest interim report with unresolved features and explicit limitations is valid; do not invent support or repeat searches merely to pass validation.`;
	}
	if (required && currentReceipts.length) {
		const finalization = [...currentReceipts].reverse().find(receipt => !target || matchesPath(receipt.reportUri, target));
		if (!finalization) {
			return `The validated report was saved to a different path. Finalize the requested deliverable at ${target} with write_patent_results and template="${structuredTemplate}".`;
		}
		const lastResearch = currentCalls.map(isRetrieval).lastIndexOf(true);
		if (lastResearch > finalization.callIndex) { return `More patent evidence was retrieved after the saved report. Reconcile it and re-save the structured ${deliverable} so its evidence companion reflects the final research boundary.`; }
	}
	// Read actual bytes, so edits made by any tool (including terminal/MCP) invalidate the receipt.
	// Latest receipt per path supersedes earlier revisions; unrelated notes do not invalidate reports.
	const relevantPriorReceipts = required || continuing || mentionsTarget ? priorReceipts : [];
	const latest = new Map([...relevantPriorReceipts, ...currentReceipts].map(receipt => [receipt.reportUri, receipt]));
	for (const receipt of latest.values()) {
		try {
			const report = await files.readFile(URI.parse(receipt.reportUri));
			const evidence = await files.readFile(URI.parse(receipt.evidenceUri));
			if (sha256Hex(report) === receipt.reportDigest && sha256Hex(evidence) === receipt.evidenceDigest) { continue; }
		} catch (error) {
			// A removed artifact loses its validation, but a transient read failure must not block the user.
			if (!isNotFound(error)) { continue; }
		}
		return `The report or its evidence companion changed after validation: ${receipt.reportUri}. Its previous validation no longer applies. If this is the requested deliverable, re-save it through write_patent_results with template="${structuredTemplate}" and revised structured evidence. If it was intentionally removed, explain that no validated deliverable remains. Do not restore a deliberately deleted file without user authorization.`;
	}
	return invalidity ? roundReportNudge(current, currentReceipts, target) : undefined;
}

/**
 * The Round Report of an invalidity chart (ADR 0016 amendment, decision 7): when the latest chart
 * saved in this turn for the requested path lists open points and the text the agent wrote after that
 * save holds no numbered question that names one of them, ask once for the Round Report. The guard
 * never asks for a Search Round: a round runs only on the expert's answer.
 */
function roundReportNudge(current: ReportCompletionTurn, currentReceipts: readonly ParsedReportReceipt[], target: string | undefined): string | undefined {
	const latest = [...currentReceipts].reverse().find(receipt => !target || matchesPath(receipt.reportUri, target));
	const ids = latest?.openPoints ?? [];
	if (!latest || !ids.length) { return undefined; }
	const after = current.rounds.slice(latest.roundIndex + 1);
	if (after.some(round => round.hookContext?.includes(roundReportNudgeMarker))) { return undefined; }
	if (namesOpenPoint(after.map(round => round.response).join('\n'), ids)) { return undefined; }
	return `The saved chart lists ${ids.length} open ${ids.length === 1 ? 'point' : 'points'} (${ids.join(', ')}) and ${roundReportNudgeMarker}. Write the Round Report now: the receipt, then each open point as a numbered question that names its id, with your recommended next step, then the line "${ROUND_REPORT_PROMPT}" Then end the turn. Do not run a Search Round before the expert answers.`;
}

/** A numbered list item or question: `1.`, `1)`, `**1.**`, `- 1.`, `Q1:` or `#1`. */
const numberedLine = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:Q|#)?\d+(?:\*\*)?[.):]/i;

/** Whether a numbered line of the text names one of the open-point ids, as `[rung-3]` or bare. */
function namesOpenPoint(text: string, ids: readonly string[]): boolean {
	const named = ids.map(id => new RegExp(`(?<![\\w.-])${escapeRegExpCharacters(id)}(?![\\w-]|\\.\\w)`, 'i'));
	return text.split('\n').some(line => numberedLine.test(line) && named.some(pattern => pattern.test(line)));
}

function receipts(turn: ReportCompletionTurn): ParsedReportReceipt[] {
	return turn.rounds.flatMap((round, roundIndex) => round.toolCalls.map(call => ({ call, roundIndex }))).flatMap(({ call, roundIndex }, callIndex) => {
		if (!finalizesStructuredReport(call)) { return []; }
		const parts = turn.results[call.id]?.content ?? [];
		return parts.flatMap(part => {
			if (!isTextPart(part)) { return []; }
			const lines = part.value.split('\n');
			const line = lines.find(line => line.startsWith(receiptPrefix));
			if (!line) { return []; }
			// The JSON holds encoded URIs and hex digests only, so the first fallback field marks its end.
			const body = line.slice(receiptPrefix.length);
			const fieldsAt = body.indexOf(fallbackFields);
			// Only a receipt with the open-points header lists open points; an older one lists none.
			const openPoints = lines.some(entry => entry.startsWith(openPointsHeader)) ? lines.flatMap(entry => { const id = openPointLine.exec(entry)?.groups?.id; return id ? [id] : []; }) : undefined;
			try {
				const value: Partial<ReportReceipt> = JSON.parse(fieldsAt < 0 ? body : body.slice(0, fieldsAt));
				if ([value.reportUri, value.reportDigest, value.evidenceUri, value.evidenceDigest].every(field => typeof field === 'string') && value.reportUri && value.evidenceUri && value.reportDigest && value.evidenceDigest) {
					return [{ reportUri: value.reportUri, reportDigest: value.reportDigest, evidenceUri: value.evidenceUri, evidenceDigest: value.evidenceDigest, roundIndex, callIndex, openPoints }];
				}
			} catch { /* Older or malformed result: no receipt. */ }
			return [];
		});
	});
}

/** Capture an explicitly named Markdown deliverable, including quoted paths with spaces. */
function requestedReportPath(message: string): string | undefined {
	const target = /\b(?:save|write|update|revise)\b(?:\s+(?:it|the|a|report|review|outputs?|results?|to|at|as|into))*\s+(?:[`"'](?<quoted>[^`"'\n]+\.md)[`"']|(?<plain>[^\s`"']+\.md)(?=\s|[,.;:]|$))/i.exec(message);
	return (target?.groups?.quoted ?? target?.groups?.plain)?.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isRetrieval(call: IToolCallRound['toolCalls'][number]): boolean {
	if (call.name === ToolName.SearchPatents) { return true; }
	if (call.name !== ToolName.GetPatentDetails) { return false; }
	try { return !JSON.parse(call.arguments).evidenceLookup; } catch { return true; }
}

function isTextPart(part: unknown): part is { value: string } {
	return !!part && typeof part === 'object' && 'value' in part && typeof part.value === 'string';
}

/**
 * Compare two path-like strings on one shape: either separator, and drive-letter paths case-folded.
 * `extUriBiasedIgnorePathCase` keys case sensitivity on the host platform, which would validate the
 * same transcript differently per machine, so the drive-letter shape decides it here instead.
 */
function comparable(left: string, right: string): readonly [string, string] {
	const first = left.replace(/[\\/]+/g, '/');
	const second = right.replace(/[\\/]+/g, '/');
	const drivePath = /(?:^|\/)[a-zA-Z]:\//;
	return drivePath.test(first) || drivePath.test(second) ? [first.toLowerCase(), second.toLowerCase()] : [first, second];
}

/** Absolute targets must be the whole path; a relative target matches any trailing segment run. */
function matchesPath(reportUri: string, target: string): boolean {
	const [path, wanted] = comparable(URI.parse(reportUri).path, target);
	return /^(?:\/|[a-zA-Z]:\/)/.test(wanted) ? path === wanted || path === '/' + wanted : path.endsWith('/' + wanted);
}

/** Windows separators are escaped inside the arguments JSON, so prefer the parsed path argument. */
function mentionsPath(call: IToolCallRound['toolCalls'][number], target: string): boolean {
	if (call.name === ToolName.WritePatentResults) {
		const filePath = parsedFilePath(call.arguments);
		if (filePath !== undefined) {
			const [path, wanted] = comparable(filePath, target);
			return path === wanted || path.endsWith('/' + wanted.replace(/^\//, ''));
		}
	}
	const [text, wanted] = comparable(call.arguments, target);
	return text.includes(wanted);
}

function parsedFilePath(argumentsText: string): string | undefined {
	try {
		const value: { filePath?: unknown } = JSON.parse(argumentsText);
		return typeof value.filePath === 'string' ? value.filePath : undefined;
	} catch { return undefined; }
}

/** Only a genuinely absent artifact invalidates a receipt; an unreachable file system is not an answer. */
function isNotFound(error: unknown): boolean {
	if (!error || typeof error !== 'object') { return false; }
	const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
	const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
	return /ENOENT|FileNotFound|EntryNotFound/i.test(code + ' ' + message);
}
