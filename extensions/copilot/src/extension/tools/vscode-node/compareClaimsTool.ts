/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError, patentBackendErrorRecoveryHint } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { IMarkdownColumn, renderMarkdownTable, truncationNotice } from './patentResponseFormatter';

interface ICompareClaimsParams {
	userClaim: string;
	patentNumbers: string[];
}

/** Max characters of an element's text shown inside a claim-chart cell before it is elided. */
const CLAIM_CHART_CELL_LIMIT = 120;

/** Per-patent cap on the full claim text rendered below the element-by-element chart. */
const CLAIM_TEXT_BUDGET = 4_000;

/** Truncates `text` to at most `max` characters, appending an ellipsis when the text was cut. */
function truncate(text: string, max: number): string {
	return text.length > max ? text.substring(0, max) + '…' : text;
}

/**
 * One decomposed segment of a claim. The preamble is the introductory phrase up to and including the
 * transitional word (`comprising`, `consisting of`, …); each subsequent limitation is a clause of the
 * claim body.
 */
interface IClaimElement {
	/** Stable row label, e.g. `Preamble` or `Element 1`. */
	readonly label: string;
	/** The segment text. */
	readonly text: string;
	/** Whether this is the preamble or a body limitation. */
	readonly type: 'preamble' | 'limitation';
}

/** A single row of the element-by-element claim chart: one reference element mapped across every patent. */
interface IClaimChartRow {
	readonly label: string;
	/** Per-patent cell text, positionally aligned to the chart's patent columns. */
	readonly cells: readonly string[];
}

/** Regexes shared by claim decomposition; declared once so the deterministic split has no per-call cost. */
const CLAIM_NUMBER_PREFIX = /^\s*\(?\d+\)?[.)]\s*/;
const CLAIM_TRANSITION = /\b(consisting essentially of|consisting of|comprising|including|containing|having|characterized in that|characterised in that)\b/i;
const CLAIM_DEPENDENCY = /\b(?:of|according to|as (?:claimed|recited|set forth|defined) in|as in)\s+(?:any\s+)?(?:one\s+of\s+)?(?:preceding\s+)?claims?\b/i;
const CLAIM_CLAUSE_LABEL = /^\(?[a-z0-9]{1,3}\)[.)]?\s+/i;

/**
 * Picks the claim to chart for a patent: the first claim that does not depend on another claim, falling
 * back to the first claim when every claim looks dependent (or the set has only one entry).
 */
function selectIndependentClaim(claims: readonly string[]): string {
	return claims.find(c => !CLAIM_DEPENDENCY.test(c)) ?? claims[0];
}

/**
 * Deterministically decomposes a single claim into its elements — no language-model call. The preamble
 * is split off at the transitional phrase; the body is then split into limitations on semicolons (the
 * standard claim-drafting delimiter), with leading clause labels like `(a)`/`1.` and trailing
 * conjunctions stripped so each row reads as a self-contained limitation.
 */
function decomposeClaim(rawClaim: string): IClaimElement[] {
	const claim = rawClaim.replace(CLAIM_NUMBER_PREFIX, '').trim();
	if (!claim) {
		return [];
	}

	const elements: IClaimElement[] = [];
	let body = claim;

	const transition = CLAIM_TRANSITION.exec(claim);
	if (transition) {
		const cut = transition.index + transition[0].length;
		elements.push({ label: 'Preamble', text: claim.slice(0, cut).trim(), type: 'preamble' });
		body = claim.slice(cut).replace(/^[:\s]+/, '').trim();
	}

	const limitations = body
		.split(/;\s*(?:and\b|or\b)?/i)
		.map(part => part.replace(CLAIM_CLAUSE_LABEL, '').replace(/[.,;]+\s*$/, '').trim())
		.filter(part => part.length > 0);

	limitations.forEach((text, i) => {
		elements.push({ label: `Element ${i + 1}`, text, type: 'limitation' });
	});

	if (elements.length === 0) {
		elements.push({ label: 'Element 1', text: claim, type: 'limitation' });
	}
	return elements;
}

interface OpsEnvelope<T> {
	success: boolean;
	data?: T;
	error?: string;
}

interface OpsClaimsData {
	docId: string;
	lang: string;
	claims: string[];
}

interface FetchedClaims {
	patentNumber: string;
	claims: string[] | null;
	failureReason?: string;
}

/**
 * Tool for comparing a user's claim against prior art patents. Fetches the actual claims of each
 * cited patent from EPO OPS (`/ops/fulltext/claims`, via the shared {@link IPatentBackendClient}
 * seam, so it inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating) and
 * returns them alongside the user's claim with an analysis rubric — the agent performs the
 * element-by-element comparison itself. Should be called AFTER search_patents to analyze
 * relevant results.
 */
export class CompareClaimsTool implements ICopilotTool<ICompareClaimsParams> {

	public static readonly toolName = ToolName.CompareClaims;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ICompareClaimsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { patentNumbers } = options.input;
		return {
			invocationMessage: l10n.t`Comparing claim against ${patentNumbers.length} patents...`,
			confirmationMessages: {
				title: l10n.t`Compare Patent Claims`,
				message: l10n.t`Allow Patent AI to compare your claim against ${patentNumbers.length} prior art patents?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ICompareClaimsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[CompareClaimsTool] Comparing claims against prior art');

		const { userClaim, patentNumbers } = options.input;

		if (!userClaim || userClaim.trim().length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: No user claim provided')
			]);
		}

		if (!patentNumbers || patentNumbers.length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: No patent numbers provided for comparison')
			]);
		}

		// Limit to 10 patents to avoid timeout
		const limitedPatents = patentNumbers.slice(0, 10);
		if (patentNumbers.length > 10) {
			this.logService.warn(`[CompareClaimsTool] Limiting comparison to first 10 patents (received ${patentNumbers.length})`);
		}

		try {
			const fetched = await Promise.all(limitedPatents.map(p => this.fetchClaims(p, token)));

			const withClaims = fetched.filter(f => f.claims && f.claims.length > 0);
			this.logService.info(`[CompareClaimsTool] Fetched claims for ${withClaims.length}/${fetched.length} patents`);

			if (withClaims.length === 0) {
				const failures = fetched.map(f => `- ${f.patentNumber}: ${f.failureReason || 'no claims returned'}`).join('\n');
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`Could not retrieve claims for any of the requested patents:\n${failures}\n\n` +
						'EPO OPS full text covers mainly EP/WO publications. For US patents, fetch claims via ' +
						'patent_api_request (POST /patent-search-uspto/search) or get_patent_details, then compare manually.'
					)
				]);
			}

			const formattedResponse = this.formatComparisonPackage(userClaim, fetched);
			this.logService.info(`[CompareClaimsTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[CompareClaimsTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Claim comparison backend returned ${error.status}: ${error.message}` + patentBackendErrorRecoveryHint(error))
				]);
			}
			this.logService.error(`[CompareClaimsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Fetch the claims of one patent. Per-patent 404s (full text not published via OPS for that
	 * jurisdiction) are reported inline rather than failing the whole comparison; auth (401/402)
	 * and cancellation errors propagate so the seam's centralized recovery UX still fires.
	 */
	private async fetchClaims(patentNumber: string, token: CancellationToken): Promise<FetchedClaims> {
		const doc = patentNumber.replace(/[-.\s/]/g, '').toUpperCase();
		try {
			const result = await this.patentBackendClient.get<OpsEnvelope<OpsClaimsData>>(
				`/ops/fulltext/claims?${new URLSearchParams({ doc }).toString()}`, token);
			if (!result.success || !result.data || result.data.claims.length === 0) {
				return { patentNumber, claims: null, failureReason: result.error || 'no claims returned' };
			}
			return { patentNumber, claims: result.data.claims };
		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.' || error.status === 401 || error.status === 402) {
					throw error;
				}
				return { patentNumber, claims: null, failureReason: `${error.status} - ${error.message}` };
			}
			return { patentNumber, claims: null, failureReason: error instanceof Error ? error.message : 'unknown error' };
		}
	}

	/**
	 * Assemble the user claim and the fetched prior-art claims into a comparison package: an
	 * element-by-element claim chart (deterministic decomposition of each patent's independent claim,
	 * rendered through the shared {@link renderMarkdownTable} primitive), the bounded full claim text
	 * per patent, and an analysis rubric for the agent.
	 */
	private formatComparisonPackage(userClaim: string, fetched: FetchedClaims[]): string {
		const withClaims = fetched.filter((f): f is FetchedClaims & { claims: string[] } => !!f.claims && f.claims.length > 0);

		const lines: string[] = [
			'## Prior Art Claim Comparison Package',
			'',
			'### User Claim',
			'```',
			userClaim.trim(),
			'```',
			'',
		];

		lines.push(...this.renderClaimChart(withClaims));

		lines.push('', '### Full Claim Text', '');
		for (const f of fetched) {
			lines.push(`#### ${f.patentNumber}`);
			if (f.claims && f.claims.length > 0) {
				lines.push(this.renderBoundedClaims(f.claims));
			} else {
				lines.push(`Claims unavailable via EPO OPS (${f.failureReason}). For US patents, fetch via patent_api_request (POST /patent-search-uspto/search).`);
			}
			lines.push('');
		}

		lines.push(
			'---',
			'### Analysis Instructions',
			'The chart above is a positional decomposition scaffold; confirm the actual element correspondence against the full claim text, then perform an element-by-element comparison of the user claim against each prior-art claim set. For each patent, report:',
			'1. **Relevance** — HIGH (anticipates most/all elements), MEDIUM (discloses several elements), or LOW.',
			'2. **Overlapping elements** — user-claim elements disclosed by the prior art, citing the specific claim number.',
			'3. **Missing elements** — user-claim elements NOT found in the prior art (potential novelty).',
			'4. **Key differences** — material differences in scope or implementation.',
			'',
			'Then summarize: HIGH-relevance patents raise §102 (anticipation) risk; combinations of MEDIUM-relevance patents may support §103 (obviousness) rejections. Use get_patent_details for full descriptions of specific patents if needed.'
		);

		return lines.join('\n');
	}

	/**
	 * Render the element-by-element claim chart: one row per element of the reference patent (the first
	 * patent with claims), one column per patent, each cell holding the positionally-aligned element of
	 * that patent's independent claim (bounded snippet) or `—` when it has no element at that position.
	 */
	private renderClaimChart(withClaims: readonly (FetchedClaims & { claims: string[] })[]): string[] {
		const decompositions = withClaims.map(f => ({
			patentNumber: f.patentNumber,
			elements: decomposeClaim(selectIndependentClaim(f.claims)),
		}));
		const reference = decompositions[0];

		const rows: IClaimChartRow[] = reference.elements.map((_element, i) => ({
			label: reference.elements[i].label,
			cells: decompositions.map(d => (d.elements[i] ? truncate(d.elements[i].text, CLAIM_CHART_CELL_LIMIT) : '—')),
		}));

		const columns: IMarkdownColumn<IClaimChartRow>[] = [
			{ header: 'Claim Element', cell: r => r.label },
			...decompositions.map((d, colIndex): IMarkdownColumn<IClaimChartRow> => ({
				header: d.patentNumber,
				cell: r => r.cells[colIndex],
			})),
		];

		return [
			'### Element-by-Element Claim Chart',
			`Rows are the elements of the reference patent (${reference.patentNumber}); \`—\` means that patent's independent claim has no element at that position. Correspondence is positional — verify it against the full claim text below.`,
			'',
			renderMarkdownTable(rows, columns),
		];
	}

	/**
	 * Render a patent's full claim text as a fenced block bounded by the per-patent
	 * {@link CLAIM_TEXT_BUDGET}: whole claims are kept in order until the budget is reached, and the
	 * shared {@link truncationNotice} reports how many were dropped.
	 */
	private renderBoundedClaims(claims: readonly string[]): string {
		const budget = CLAIM_TEXT_BUDGET;
		const kept: string[] = [];
		let used = 0;
		let omitted = 0;
		for (let i = 0; i < claims.length; i++) {
			const addition = claims[i].length + (kept.length > 0 ? 2 : 0);
			if (kept.length > 0 && used + addition > budget) {
				omitted = claims.length - i;
				break;
			}
			kept.push(claims[i]);
			used += addition;
		}

		const text = truncate(kept.join('\n\n'), budget);
		const block = ['```', text, '```'];
		if (omitted > 0) {
			block.push('', `> ${truncationNotice(omitted, budget)}`);
		}
		return block.join('\n');
	}
}

ToolRegistry.registerTool(CompareClaimsTool);
