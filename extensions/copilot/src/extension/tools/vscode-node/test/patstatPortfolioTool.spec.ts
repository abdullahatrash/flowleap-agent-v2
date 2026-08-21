/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { PatentBackendError, TransientBackendError, type IPatentBackendClient, type IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { PatstatPortfolioTool } from '../patstatPortfolioTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/**
 * A {@link IPatentBackendClient} whose `post` returns a scripted payload (or throws a scripted error),
 * capturing the paths and bodies it was called with so the test can assert the tool routes the
 * portfolio contract through the shared client seam.
 */
function makeBackendClient(postResult?: unknown | (() => never)) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		getTrialModelKey(): never { throw new Error('getTrialModelKey not exercised in this test fake'); },
		async post<T>(path: string, body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body });
			if (typeof postResult === 'function') {
				return (postResult as () => never)();
			}
			return postResult as T;
		},
		async get<T>(pathWithQuery: string, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path: pathWithQuery });
			return undefined as T;
		},
	};
	return { client, calls };
}

/** Stub CancellationToken that is never cancelled. */
function makeToken(): CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested() {
			return { dispose: () => { /* noop */ } };
		},
	};
}

/** Minimal invocation options — the tool only reads `options.input`. */
function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

/** Read the single text part produced by a tool invocation. */
function textOf(result: vscode.LanguageModelToolResult): string {
	const part = result.content[0];
	return (part as LanguageModelTextPart).value;
}

/** A representative `/patstat/portfolio` success body (backend #141/#146 contract). */
const fixturePortfolio = {
	success: true,
	applicant: {
		query: 'Kia',
		matched_name: 'KIA MOTORS',
		matched_psn_names: ['KIA MOTORS CORPORATION', 'KIA MOTORS CORP.'],
		other_matches: [{ name: 'KIA WAH', applications: 3 }],
	},
	filters: { from_year: 2015, to_year: 2024 },
	totals: { applications: 1200, granted: 700 },
	by_year: [
		{ year: 2015, applications: 100, granted: 80 },
		{ year: 2016, applications: 130, granted: 90 },
	],
	by_office: [
		{ office: 'KR', applications: 600, granted: 400 },
		{ office: 'US', applications: 400, granted: 300 },
		{ office: 'WO', applications: 200, granted: null },
	],
	by_year_office: [
		{ year: 2015, office: 'KR', applications: 60, granted: 40 },
	],
	grant_status_caveats: [
		'WO: PCT applications never grant at WIPO — grant status is structurally meaningless',
		'Grant counts for the flagged authorities are reported as null and excluded from totals.',
	],
	notes: [
		'Publication lag: filing counts for 2025–2024 are incomplete (applications publish ~18 months after filing) — do not read the tail years as a decline.',
	],
	summary: 'KIA MOTORS: 1200 patent applications filed 2015–2024 across 3 offices (top: KR 600, US 400, WO 200); 700 granted among offices with reliable grant status. Source: PATSTAT 2026 Spring.',
	data_edition: 'PATSTAT 2026 Spring',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PatstatPortfolioTool', () => {

	it('posts the portfolio contract and renders summary, edition, and aggregate tables', async () => {
		const { client, calls } = makeBackendClient(fixturePortfolio);
		const tool = new PatstatPortfolioTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicant: 'Kia', fromYear: 2015, toYear: 2024 }), makeToken());

		expect(calls).toEqual([{
			path: '/patstat/portfolio',
			body: { applicant: 'Kia', fromYear: 2015, toYear: 2024 },
		}]);

		const text = textOf(result);
		// The quotable summary and the PATSTAT edition are the headline deliverables (#159 acceptance).
		expect(text).toContain('KIA MOTORS: 1200 patent applications filed 2015–2024');
		expect(text).toContain('PATSTAT 2026 Spring');
		// Aggregate tables.
		expect(text).toContain('| 2015 | 100 | 80 |');
		expect(text).toContain('| KR | 600 | 400 |');
		// Unreliable grant status renders as n/a, never as 0.
		expect(text).toContain('| WO | 200 | n/a |');
		// Alias grouping and excluded sibling entities are surfaced.
		expect(text).toContain('KIA MOTORS CORPORATION');
		expect(text).toContain('KIA WAH');
		// Backend caveats and notes travel through verbatim.
		expect(text).toContain('PCT applications never grant at WIPO');
		expect(text).toContain('Publication lag');
		// Snapshot caveat: current legal status must be deferred to the live route.
		expect(text).toContain('get_legal_status');
	});

	it('omits unset year bounds and trims the applicant in the request body', async () => {
		const { client, calls } = makeBackendClient(fixturePortfolio);
		const tool = new PatstatPortfolioTool(makeLogService(), client);

		// The backend matches the applicant as a harmonized-name PREFIX, so stray whitespace
		// must never reach the wire.
		await tool.invoke(makeOptions({ applicant: '  Siemens ' }), makeToken());

		expect(calls).toEqual([{ path: '/patstat/portfolio', body: { applicant: 'Siemens' } }]);
	});

	it('rejects a missing/too-short applicant without calling the backend', async () => {
		const { client, calls } = makeBackendClient(fixturePortfolio);
		const tool = new PatstatPortfolioTool(makeLogService(), client);

		const missing = await tool.invoke(makeOptions({} as { applicant: string }), makeToken());
		const tooShort = await tool.invoke(makeOptions({ applicant: ' A ' }), makeToken());

		expect(calls).toEqual([]);
		expect(textOf(missing)).toBe('Error: Provide `applicant` — the company/applicant name (at least 2 characters), matched against harmonized PSN names.');
		expect(textOf(tooShort)).toBe('Error: Provide `applicant` — the company/applicant name (at least 2 characters), matched against harmonized PSN names.');
	});

	it('surfaces the applicant-not-found suggestion from the backend error envelope', async () => {
		const envelope = JSON.stringify({
			success: false,
			error: {
				code: 'patstat_applicant_not_found',
				message: 'No harmonized applicant (PSN) names start with "Siemenz". Try a shorter name prefix (e.g. the company name without its legal form) or check the spelling.',
			},
			status: 404,
		});
		const { client } = makeBackendClient(() => { throw new PatentBackendError(404, envelope); });
		const tool = new PatstatPortfolioTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicant: 'Siemenz' }), makeToken());

		expect(textOf(result)).toBe(
			'Error: PATSTAT portfolio returned 404 (patstat_applicant_not_found): No harmonized applicant (PSN) names start with "Siemenz". ' +
			'Try a shorter name prefix (e.g. the company name without its legal form) or check the spelling.'
		);
	});

	it('surfaces ambiguous-applicant candidates from the backend error envelope', async () => {
		const envelope = JSON.stringify({
			success: false,
			error: {
				code: 'patstat_applicant_ambiguous',
				message: '"LG" matches 3 distinct applicant entities: LG ELECTRONICS (9000 applications), LG CHEM (5000 applications), LG DISPLAY (3000 applications). These may be separate companies, so they are not merged automatically — retry with a more specific name (one of the entities listed).',
				candidates: [
					{ name: 'LG ELECTRONICS', applications: 9000 },
					{ name: 'LG CHEM', applications: 5000 },
					{ name: 'LG DISPLAY', applications: 3000 },
				],
			},
			status: 422,
		});
		const { client } = makeBackendClient(() => { throw new PatentBackendError(422, envelope); });
		const tool = new PatstatPortfolioTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicant: 'LG' }), makeToken());

		const text = textOf(result);
		expect(text).toContain('patstat_applicant_ambiguous');
		expect(text).toContain('LG ELECTRONICS (9000 applications)');
		expect(text).toContain('retry with a more specific name');
	});

	it('falls back to the raw message when the error body is not a parseable envelope', async () => {
		const { client } = makeBackendClient(() => { throw new PatentBackendError(400, 'Bad Request'); });
		const tool = new PatstatPortfolioTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicant: 'Kia' }), makeToken());

		expect(textOf(result)).toBe('Error: PATSTAT portfolio returned 400: Bad Request');
	});

	it('adds the analytics-layer hint on a 503 (patstat unavailable arrives as a transient error)', async () => {
		// The shared client strips 5xx bodies, so the tool cannot see `patstat_unavailable`;
		// it must still steer the agent usefully on any 503.
		const { client } = makeBackendClient(() => { throw new TransientBackendError('The FlowLeap backend returned HTTP 503.', 503); });
		const tool = new PatstatPortfolioTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicant: 'Kia' }), makeToken());

		const text = textOf(result);
		expect(text).toContain('PATSTAT analytics layer');
		expect(text).toContain('OPS/USPTO');
	});
});
