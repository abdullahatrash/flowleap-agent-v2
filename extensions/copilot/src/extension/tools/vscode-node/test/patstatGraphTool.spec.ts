/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { PatentBackendError, type IPatentBackendClient, type IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { PatstatGraphTool } from '../patstatGraphTool';

// ── Fakes (patstatQueryTool.spec.ts pattern) ───────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

function makeBackendClient(getResult?: unknown | (() => never)) {
	const calls: { path: string }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		async post<T>(path: string, _body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path });
			return undefined as T;
		},
		async get<T>(pathWithQuery: string, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path: pathWithQuery });
			if (typeof getResult === 'function') {
				return (getResult as () => never)();
			}
			return getResult as T;
		},
	};
	return { client, calls };
}

function makeToken(): CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested() {
			return { dispose: () => { /* noop */ } };
		},
	};
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function textOf(result: vscode.LanguageModelToolResult): string {
	return (result.content[0] as LanguageModelTextPart).value;
}

// ── Fixtures (shapes captured from the live backend, backend #245) ─────────────

/** An agent verb body: `text` is the deliverable, `data` carries the same facts as JSON. */
const verbFixture = {
	success: true,
	text: '# neighborhood pat:502192934 (EP3477840B1) depth=1 edge_types=cited_by — PATSTAT 2026 Spring\nEP3477840B1 --cited_by/SEA [EXTRACTED 1]--> EP3796345A1 "WELDING TRANSFORMER" at=tls212:546146684/2',
	data: { edges: [], nodes: [] },
};

const resolveAnchorFixture = {
	success: true,
	kind: 'patent',
	anchor: {
		node: 'pat:502192934',
		application: 'EP18000829 (A)',
		title: 'WELDING TRANSFORMER',
		filing_year: 2018,
		granted: true,
		docdb_family_id: 64048651,
		publications: [{ publn: 'EP3477840B1', date: '2020-05-27', first_grant: true, at: 'tls211:530028653' }],
		confidence: { tag: 'EXTRACTED', score: 1 },
		at: 'tls201:502192934',
	},
};

const resolveEntitiesFixture = {
	success: true,
	kind: 'entities',
	input: 'Siemens',
	total: 1807,
	truncated: true,
	candidates: [
		{ node: 'person:30138991', psn_id: 30138991, name: 'SIEMENS', applications: 363045, person_variants: 2492, confidence: { tag: 'INFERRED', score: 0.85 } },
		{ node: 'person:30140513', psn_id: 30140513, name: 'SIEMENS-SCHUCKERTWERKE', applications: 51309, person_variants: 445, confidence: { tag: 'INFERRED', score: 0.85 } },
	],
};

const patentViewFixture = {
	success: true,
	meta: {
		data_edition: 'PATSTAT 2026 Spring',
		attribution: 'This product contains data sourced from EPO databases, © European Patent Organisation',
		data_quality: [{ node: 'pat:502192934', issue: 'unknown_filing_date', detail: '2 application(s) carry the 9999 sentinel.' }],
		truncation: {
			forward: { truncated: true, shown: 200, total: 812, ranking: 'examiner-origin citations first, then citing-family size' },
			backward_patent: { truncated: false, shown: 9, total: 9 },
		},
	},
	anchor: { node: 'pat:502192934', application: 'EP18000829 (A)', title: 'WELDING TRANSFORMER', filing_year: 2018, granted: true, docdb_family_id: 64048651, publications: [{ publn: 'EP3477840B1' }] },
	header: {
		applicants: [{ name: 'UNIVERSITY OF MARIBOR', country: 'SI', confidence: { tag: 'EXTRACTED', score: 1 }, at: 'tls207:51293054/1' }],
		inventors: [{ name: 'BREZOVNIK, ROBERT', country: 'SI', confidence: { tag: 'EXTRACTED', score: 1 }, at: 'tls207:55791767/1' }],
		cpc: [{ symbol: 'B23K  11/11', confidence: { tag: 'EXTRACTED', score: 1 }, at: 'tls224:502192934' }],
	},
	citations: {
		backward_patent: [{ cited: 'US2014321184A1', title: 'Synchronous rectifier', date: '2014-10-30', origin: 'APP', confidence: { tag: 'EXTRACTED', score: 1 }, at: 'tls212:510105714/6' }],
		backward_npl: [],
		backward_unresolved: [],
		forward: [{ citing: 'EP3796345A1', title: 'WELDING TRANSFORMER', applicant: 'ROBERT BOSCH', date: '2021-03-24', origin: 'SEA', examiner_cited: true, citing_family_size: 2, confidence: { tag: 'EXTRACTED', score: 1 }, at: 'tls212:546146684/2' }],
	},
	family: [{ application: 'SI201700288 (A)', office: 'SI', filing_year: 2017, first_grant_date: '2019-04-30', is_anchor: false, confidence: { tag: 'EXTRACTED', score: 1 }, at: 'tls201:511961846' }],
	priorities: [{ prior_application: 'SI201700288', prior_filing_date: '2017-10-26', confidence: { tag: 'EXTRACTED', score: 1 }, at: 'tls204:502192934/1' }],
};

const applicantViewFixture = {
	success: true,
	meta: {
		data_edition: 'PATSTAT 2026 Spring',
		truncation: { co_applicants: { truncated: true, shown: 20, total: 143 } },
		data_quality: [],
	},
	entity: {
		node: 'person:30138991',
		psn_id: 30138991,
		name: 'SIEMENS',
		applications: 363045,
		person_variants: 2492,
		confidence: { tag: 'INFERRED', score: 0.85 },
		at: 'tls206:psn/30138991',
		name_grouping: { note: 'PSN harmonized grouping (same_entity_as) — the entity is an inferred name cluster', confidence: { tag: 'INFERRED', score: 0.85 } },
	},
	filings_by_year: [{ year: 2020, applications: 4210 }],
	top_cpc: [{ symbol: 'H04L', applications: 25309 }],
	jurisdictions: [{ office: 'DE', applications: 121689 }],
	co_applicants: [{ name: 'IBM (INTERNATIONAL BUSINESS MACHINES CORPORATION)', psn_id: 13775122, shared_applications: 570, confidence: { tag: 'INFERRED', score: 0.85 }, at: 'tls206:psn/13775122' }],
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PatstatGraphTool', () => {

	it('maps each operation onto its graph route, omitting unset bounds', async () => {
		const { client, calls } = makeBackendClient(verbFixture);
		const tool = new PatstatGraphTool(makeLogService(), client);
		const token = makeToken();

		await tool.invoke(makeOptions({ operation: 'resolve' as const, query: 'EP3477840' }), token);
		await tool.invoke(makeOptions({ operation: 'patent_view' as const, publication: 'EP3477840' }), token);
		await tool.invoke(makeOptions({ operation: 'applicant_view' as const, psnId: 30138991 }), token);
		await tool.invoke(makeOptions({ operation: 'neighborhood' as const, node: 'pat:502192934', depth: 2, edgeTypes: 'cites,cited_by' }), token);
		await tool.invoke(makeOptions({ operation: 'path' as const, a: 'EP3477840', b: 'US5960411', maxHops: 3 }), token);
		await tool.invoke(makeOptions({ operation: 'explain' as const, node: 'EP3477840', tokenBudget: 4000 }), token);

		expect(calls.map(call => call.path)).toStrictEqual([
			'/patstat/graph/resolve?q=EP3477840',
			'/patstat/graph/patent/EP3477840',
			'/patstat/graph/applicant/30138991',
			'/patstat/graph/neighborhood?node=pat%3A502192934&depth=2&edge_types=cites%2Ccited_by',
			'/patstat/graph/path?a=EP3477840&b=US5960411&max_hops=3',
			'/patstat/graph/explain?node=EP3477840&token_budget=4000',
		]);
	});

	it('relays an agent verb\'s text VERBATIM, with the confidence/provenance instruction alongside it', async () => {
		const { client } = makeBackendClient(verbFixture);
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'neighborhood' as const, node: 'EP3477840' }), makeToken()));

		expect(text).toContain(verbFixture.text);
		expect(text).toContain('Quote these lines WITH their confidence tag');
		expect(text).toContain('Do not present a TRUNCATED listing as complete');
	});

	it('tells the model a path miss is an answer, not a failure', async () => {
		const { client } = makeBackendClient({ success: true, text: '# path EP3477840B1 → US5960411A (max_hops=2)\nNOT FOUND within the hop limit.' });
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'path' as const, a: 'EP3477840', b: 'US5960411' }), makeToken()));

		expect(text).toContain('NOT FOUND within the hop limit');
		expect(text).toContain('is an ANSWER, not a failure');
		expect(text).toContain('not proof of unrelatedness');
	});

	it('renders a resolved anchor with the node id the other operations take', async () => {
		const { client } = makeBackendClient(resolveAnchorFixture);
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'resolve' as const, query: 'EP3477840' }), makeToken()));

		expect(text).toContain('`pat:502192934`');
		expect(text).toContain('EP3477840B1');
		expect(text).toContain('EXTRACTED');
	});

	it('presents entity candidates as a pick-one list with the TRUE total, never an answer', async () => {
		const { client } = makeBackendClient(resolveEntitiesFixture);
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'resolve' as const, query: 'Siemens' }), makeToken()));

		expect(text).toContain('Showing 2 of 1807 matching entities');
		expect(text).toContain('| 30138991 | SIEMENS |');
		expect(text).toContain('PICK-ONE LIST, not an answer');
		expect(text).toContain('never merge entities');
	});

	it('renders every patent_view section (including the empty ones) with truncation, edition and data-quality flags', async () => {
		const { client } = makeBackendClient(patentViewFixture);
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'patent_view' as const, publication: 'EP3477840' }), makeToken()));

		expect({
			everySectionHeaderPresent: ['Applicants', 'Inventors', 'CPC Classifications', 'Backward Citations — Patents', 'Backward Citations — Non-Patent Literature', 'Backward Citations — Unresolved', 'Forward Citations', 'DOCDB Family', 'Priority Claims'].every(section => text.includes(`### ${section}`)),
			emptySectionsSayNoneRecorded: text.includes('(none recorded)'),
			truncationCarriesTheTrueTotal: text.includes('the backend returned 200 of 812 forward citations (ranked by examiner-origin citations first'),
			dataQualityFlagged: text.includes('unknown_filing_date'),
			editionCited: text.includes('PATSTAT 2026 Spring'),
			attributionCarried: text.includes('© European Patent Organisation'),
			confidenceDisciplineStated: text.includes('EXTRACTED is a direct PATSTAT row'),
			snapshotCaveat: text.includes('never present snapshot data as current'),
			citationUniversesDistinguished: text.includes('WORLDWIDE DOCDB citation network'),
		}).toEqual({
			everySectionHeaderPresent: true,
			emptySectionsSayNoneRecorded: true,
			truncationCarriesTheTrueTotal: true,
			dataQualityFlagged: true,
			editionCited: true,
			attributionCarried: true,
			confidenceDisciplineStated: true,
			snapshotCaveat: true,
			citationUniversesDistinguished: true,
		});
	});

	it('renders applicant_view with its entity-boundary warning and no implied cap on filings by year', async () => {
		const { client } = makeBackendClient(applicantViewFixture);
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'applicant_view' as const, psnId: 30138991 }), makeToken()));

		expect(text).toContain('PSN harmonized grouping');
		expect(text).toContain('the backend returned 20 of 143 co-applicants');
		expect(text).toContain('ENTITY BOUNDARY');
		expect(text).toContain('patstat_portfolio groups by name-prefix alias');
		expect(text).not.toContain('filing years (ranked');
	});

	// Caught in live acceptance: SIEMENS returns 126 year rows, ascending, and the 40-row section
	// default rendered 1884-1937 — i.e. it answered "how does this applicant file?" with the 1880s
	// and hid every modern year. The year distribution renders whole.
	it('renders the whole filing-year distribution, not its oldest rows', async () => {
		const filings_by_year = Array.from({ length: 126 }, (_, i) => ({ year: 1884 + i, applications: i }));
		const { client } = makeBackendClient({ ...applicantViewFixture, filings_by_year });
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'applicant_view' as const, psnId: 30138991 }), makeToken()));

		expect(text).toContain('| 1884 |');
		expect(text).toContain('| 2009 |');
		expect(text).not.toContain('returned filing years rendered here');
	});

	it('presents ambiguous-number candidates as an interaction step and never auto-picks', async () => {
		const envelope = JSON.stringify({
			success: false,
			status: 422,
			error: {
				code: 'patstat_patent_ambiguous',
				message: '"EP0000001" matches 2 distinct applications: EP0000001 (D2), EP78200013 (A). Add the kind code (e.g. A1 vs B1) or use a fuller number form to disambiguate.',
				candidates: [
					{ node: 'pat:930482825', application: 'EP0000001 (D2)', title: null, filing_year: null, granted: false, publications: [{ publn: 'EP0000001A', date: '9999-12-31' }] },
					{ node: 'pat:16428854', application: 'EP78200013 (A)', title: 'THERMAL HEAT PUMP', filing_year: 1978, granted: true, publications: [{ publn: 'EP0000001B1', date: '1981-01-07' }] },
				],
			},
		});
		const { client } = makeBackendClient(() => { throw new PatentBackendError(422, envelope); });
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'patent_view' as const, publication: 'EP0000001' }), makeToken()));

		expect(text).toContain('matches 2 distinct applications');
		expect(text).toContain('pat:930482825');
		expect(text).toContain('THERMAL HEAT PUMP');
		expect(text).toContain('DO NOT PICK ONE YOURSELF');
		// The 9999 sentinel is a missing year, never a year to quote.
		expect(text).toContain('unknown');
	});

	// The 422 ambiguity body runs ~1000 characters; the shared client caps error bodies at 500, so
	// the truncated prefix no longer parses. The recovery that always works is resolve (a 200).
	it('falls back to the resolve recovery when the ambiguity envelope was truncated by the client', async () => {
		const truncated = '{"error":{"candidates":[{"application":"EP0000001 (D2)","appln_id":930482825,"at":"tls201:930482825"…';
		const { client } = makeBackendClient(() => { throw new PatentBackendError(422, truncated); });
		const tool = new PatstatGraphTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ operation: 'patent_view' as const, publication: 'EP0000001' }), makeToken()));

		expect(text).toContain('patstat_patent_ambiguous');
		expect(text).toContain('operation="resolve"');
		expect(text).toContain('never choose one yourself');
	});

	it('relays every other typed graph error verbatim with its recovery steer', async () => {
		const cases: { status: number; code: string; message: string; expect: string }[] = [
			{ status: 404, code: 'patstat_patent_not_found', message: 'No publication in the loaded PATSTAT edition matches "EP9999999".', expect: 'may simply postdate the snapshot' },
			{ status: 404, code: 'patstat_entity_not_found', message: 'No harmonized (PSN) applicant entity matches "psn_id 999999999".', expect: 'may simply postdate the snapshot' },
			{ status: 400, code: 'patstat_invalid_request', message: '`depth` must be 1 or 2 (per-hop cap 200 — engine spec #200).', expect: 'call operation="resolve" first' },
			{ status: 503, code: 'patstat_unavailable', message: 'The graph engine is not configured on this deployment.', expect: 'do NOT retry-loop' },
		];

		for (const testCase of cases) {
			const envelope = JSON.stringify({ success: false, status: testCase.status, error: { code: testCase.code, message: testCase.message } });
			const { client } = makeBackendClient(() => { throw new PatentBackendError(testCase.status, envelope); });
			const tool = new PatstatGraphTool(makeLogService(), client);

			const text = textOf(await tool.invoke(makeOptions({ operation: 'explain' as const, node: 'EP9999999' }), makeToken()));

			expect(text).toContain(testCase.code);
			expect(text).toContain(testCase.message);
			expect(text).toContain(testCase.expect);
		}
	});

	it('short-circuits malformed calls before any network round-trip', async () => {
		const { client, calls } = makeBackendClient(verbFixture);
		const tool = new PatstatGraphTool(makeLogService(), client);
		const token = makeToken();

		const missingQuery = textOf(await tool.invoke(makeOptions({ operation: 'resolve' as const }), token));
		const nameAsPsnId = textOf(await tool.invoke(makeOptions({ operation: 'applicant_view' as const }), token));
		const missingEndpoint = textOf(await tool.invoke(makeOptions({ operation: 'path' as const, a: 'EP3477840' }), token));

		expect(calls).toHaveLength(0);
		expect(missingQuery).toContain('Provide `query`');
		expect(nameAsPsnId).toContain('a company name will not work here');
		expect(missingEndpoint).toContain('Provide both `a` and `b`');
	});
});
