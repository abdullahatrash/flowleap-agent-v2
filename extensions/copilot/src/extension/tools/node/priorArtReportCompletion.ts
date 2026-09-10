/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import type { LanguageModelToolResult } from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { URI } from '../../../util/vs/base/common/uri';
import { IToolCallRound } from '../../prompt/common/intents';
import { ToolName } from '../common/toolNames';

interface ReportReceipt {
	readonly reportUri: string;
	readonly reportDigest: string;
	readonly evidenceUri: string;
	readonly evidenceDigest: string;
}

interface ParsedReportReceipt extends ReportReceipt {
	readonly callIndex: number;
}

const receiptPrefix = 'Prior-art artifact receipt: ';

/** Bind the report and its evidence revision to the bytes the structured writer actually saved. */
export function priorArtReportReceipt(report: URI, document: string, evidence: URI, snapshot: string): string {
	return receiptPrefix + JSON.stringify({ reportUri: report.toString(), reportDigest: digest(document), evidenceUri: evidence.toString(), evidenceDigest: digest(snapshot) } satisfies ReportReceipt);
}

function digest(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

/** Conservative routing for explicit English prior-art deliverable requests, not every patent question. */
export function requestsPriorArtReport(message: string): boolean {
	return /\bprior[\s-]+art\b/i.test(message) && /\b(report|review|save|write|output)\b/i.test(message);
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
	const writingReport = currentCalls.some(call => {
		if (call.name !== ToolName.WritePatentResults) { return false; }
		try { return JSON.parse(call.arguments).template === 'prior-art-report'; } catch { return false; }
	});
	const mentionsTarget = !!target && currentCalls.some(call => mentionsPath(call, target));
	const continuing = /^\s*continue\b/i.test(current.message) || /\b(revise|update|correct)\b.*\b(report|review)\b/i.test(current.message);
	const pendingResearch = !priorReceipts.length && activeHistory.some(turn => turn.rounds.some(round => round.toolCalls.some(isRetrieval)));
	const genericWrite = currentCalls.some(call => [ToolName.CreateFile, ToolName.EditFile, ToolName.ApplyPatch, ToolName.ReplaceString, ToolName.MultiReplaceString, ToolName.CoreRunInTerminal, ToolName.CoreSendToTerminal].some(name => name === call.name));
	const currentReportRequest = requestsPriorArtReport(current.message);
	const required = writingReport || (currentReportRequest && (hasResearch || genericWrite)) || (!!reportRequest && hasResearch && (continuing || !!mentionsTarget)) || (pendingResearch && (hasResearch || continuing || !!mentionsTarget));
	if (required && !currentReceipts.length) {
		return 'The requested prior-art report has no successful structured finalization in this turn. Generic file writes and free-form writer calls are unvalidated drafts. Save the requested report with write_patent_results, template="prior-art-report", empty content and the evidence-backed coverage fields. An honest interim report with unresolved features and explicit limitations is valid; do not invent support or repeat searches merely to pass validation.';
	}
	if (required && currentReceipts.length) {
		const finalization = [...currentReceipts].reverse().find(receipt => !target || matchesPath(receipt.reportUri, target));
		if (!finalization) {
			return `The validated report was saved to a different path. Finalize the requested deliverable at ${target} with write_patent_results and template="prior-art-report".`;
		}
		const lastResearch = currentCalls.map(isRetrieval).lastIndexOf(true);
		if (lastResearch > finalization.callIndex) { return 'More patent evidence was retrieved after the saved report. Reconcile it and re-save the structured prior-art report so its evidence companion reflects the final research boundary.'; }
	}
	// Read actual bytes, so edits made by any tool (including terminal/MCP) invalidate the receipt.
	// Latest receipt per path supersedes earlier revisions; unrelated notes do not invalidate reports.
	const relevantPriorReceipts = required || continuing || mentionsTarget ? priorReceipts : [];
	const latest = new Map([...relevantPriorReceipts, ...currentReceipts].map(receipt => [receipt.reportUri, receipt]));
	for (const receipt of latest.values()) {
		try {
			const report = await files.readFile(URI.parse(receipt.reportUri));
			const evidence = await files.readFile(URI.parse(receipt.evidenceUri));
			if (digest(report) === receipt.reportDigest && digest(evidence) === receipt.evidenceDigest) { continue; }
		} catch (error) {
			// A removed artifact loses its validation, but a transient read failure must not block the user.
			if (!isNotFound(error)) { continue; }
		}
		return `The prior-art report or its evidence companion changed after validation: ${receipt.reportUri}. Its previous validation no longer applies. If this is the requested deliverable, re-save it through write_patent_results with template="prior-art-report" and revised structured evidence. If it was intentionally removed, explain that no validated deliverable remains. Do not restore a deliberately deleted file without user authorization.`;
	}
	return undefined;
}

function receipts(turn: ReportCompletionTurn): ParsedReportReceipt[] {
	return turn.rounds.flatMap(round => round.toolCalls).flatMap((call, callIndex) => {
		if (call.name !== ToolName.WritePatentResults) { return []; }
		try { if (JSON.parse(call.arguments).template !== 'prior-art-report') { return []; } } catch { return []; }
		const parts = turn.results[call.id]?.content ?? [];
		return parts.flatMap(part => {
			if (!isTextPart(part)) { return []; }
			const line = part.value.split('\n').find(line => line.startsWith(receiptPrefix));
			if (!line) { return []; }
			try {
				const value: Partial<ReportReceipt> = JSON.parse(line.slice(receiptPrefix.length));
				if ([value.reportUri, value.reportDigest, value.evidenceUri, value.evidenceDigest].every(field => typeof field === 'string') && value.reportUri && value.evidenceUri && value.reportDigest && value.evidenceDigest) {
					return [{ reportUri: value.reportUri, reportDigest: value.reportDigest, evidenceUri: value.evidenceUri, evidenceDigest: value.evidenceDigest, callIndex }];
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
