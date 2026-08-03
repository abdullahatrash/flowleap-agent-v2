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
import { PatstatQueryTool } from '../patstatQueryTool';

// ── Fakes (patstatPortfolioTool.spec.ts pattern) ───────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

function makeBackendClient(postResult?: unknown | (() => never)) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
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
	const part = result.content[0];
	return (part as LanguageModelTextPart).value;
}

/** A representative `/patstat/query` success body (backend spec §1). */
const fixtureResult = {
	success: true,
	rows: [
		{ office: 'EP', inventions: 4210 },
		{ office: 'US', inventions: 3980 },
	],
	rowCount: 2,
	data_edition: 'PATSTAT 2026 Spring',
};

const SQL = "SELECT office, COUNT(DISTINCT family_id) AS inventions FROM flowleap.applications GROUP BY office";

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PatstatQueryTool', () => {

	it('posts sql + audit-only fields to /patstat/query through the shared client seam', async () => {
		const { client, calls } = makeBackendClient(fixtureResult);
		const tool = new PatstatQueryTool(makeLogService(), client);

		await tool.invoke(makeOptions({ sql: SQL, question: 'where does X hold inventions?', retryOf: 'patstat_sql_error' }), makeToken());

		expect(calls).toHaveLength(1);
		expect(calls[0].path).toBe('/patstat/query');
		expect(calls[0].body).toEqual({
			sql: SQL,
			question: 'where does X hold inventions?',
			retryOf: 'patstat_sql_error',
		});
	});

	it('renders rows as a table with data_edition and the interpretation contract', async () => {
		const { client } = makeBackendClient(fixtureResult);
		const tool = new PatstatQueryTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ sql: SQL }), makeToken()));

		expect(text).toContain('| office | inventions |');
		expect(text).toContain('| EP | 4210 |');
		expect(text).toContain('PATSTAT 2026 Spring');
		expect(text).toContain('interpretation');
	});

	it('surfaces warn-band warnings on the success path', async () => {
		const { client } = makeBackendClient({
			...fixtureResult,
			warnings: [{ code: 'patstat_sql_expensive', message: 'Estimated plan cost 2,100,000 exceeds the warn threshold — consider narrowing.' }],
		});
		const tool = new PatstatQueryTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ sql: SQL }), makeToken()));

		expect(text).toContain('patstat_sql_expensive');
		expect(text).toContain('2,100,000');
	});

	it('short-circuits a missing sql before any network call, pointing at the semantic model', async () => {
		const { client, calls } = makeBackendClient(fixtureResult);
		const tool = new PatstatQueryTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ sql: '   ' }), makeToken()));

		expect(calls).toHaveLength(0);
		expect(text).toContain('semantic-model');
	});

	it('relays a typed gate rejection VERBATIM with code, details, and the one-retry instruction', async () => {
		const envelope = JSON.stringify({
			success: false,
			status: 400,
			error: {
				code: 'patstat_sql_error',
				message: 'column "apln_id" does not exist — fix the SQL against the schema in /v1/patstat/docs and retry once.',
				sqlstate: '42703',
				position: 8,
				hint: 'Perhaps you meant to reference the column "applications.application_id".',
			},
		});
		const { client } = makeBackendClient(() => { throw new PatentBackendError(400, envelope); });
		const tool = new PatstatQueryTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ sql: 'SELECT apln_id FROM flowleap.applications' }), makeToken()));

		expect(text).toContain('patstat_sql_error');
		expect(text).toContain('column "apln_id" does not exist');
		expect(text).toContain('42703');
		expect(text).toContain('Perhaps you meant');
		expect(text).toContain('resubmit with retryOf');
		expect(text).toContain('second failure, stop');
	});

	it('flags patstat_busy as back-off (same SQL), not a rewrite signal', async () => {
		const envelope = JSON.stringify({
			success: false,
			status: 503,
			error: {
				code: 'patstat_busy',
				message: 'All guarded-SQL slots are busy. Retry after 5s — this is load, not a problem with your SQL; do not rewrite the query.',
			},
		});
		const { client } = makeBackendClient(() => { throw new PatentBackendError(503, envelope); });
		const tool = new PatstatQueryTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ sql: SQL }), makeToken()));

		expect(text).toContain('patstat_busy');
		expect(text).toContain('retry the SAME SQL');
	});

	it('handles a zero-row result with probe guidance instead of an empty table', async () => {
		const { client } = makeBackendClient({ success: true, rows: [], rowCount: 0, data_edition: 'PATSTAT 2026 Spring' });
		const tool = new PatstatQueryTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ sql: SQL }), makeToken()));

		expect(text).toContain('0 rows');
		expect(text).toContain('Probe');
	});

	it('caps the rendered table and says how many rows were shown', async () => {
		const rows = Array.from({ length: 120 }, (_, i) => ({ name: `APPLICANT ${i}`, families: i }));
		const { client } = makeBackendClient({ success: true, rows, rowCount: 120, data_edition: 'PATSTAT 2026 Spring' });
		const tool = new PatstatQueryTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ sql: SQL }), makeToken()));

		expect(text).toContain('APPLICANT 49');
		expect(text).not.toContain('APPLICANT 50 |');
		expect(text).toContain('(50 of 120 rows shown');
	});
});
