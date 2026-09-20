/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ILogService } from '../../../../platform/log/common/logService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { IPatentBackendClient, IPatentBackendRequestOptions } from '../patentBackendClient';
import { buildPatentPill, PatentLinkPresentationProvider, readKindStage, readPatentPillFacts } from '../patentLinkPresentationProvider';

const READER_LINK = 'flowleap://flowleap.patent-ai/patent?publication=EP1602570B1&section=claims&claim=1';
const GOOGLE_LINK = 'https://patents.google.com/patent/EP1602570B1/en';
const US_LINK = 'https://patents.google.com/patent/US10958080B2/en';

const summary = {
	bibliography: { title: 'Fuel cell stack with cooling plates', applicants: ['Ballard Power Systems Inc', 'Daimler AG'] },
	legalStatus: { events: [{ code: 'PGFP', date: '2016-03-01' }, { code: 'PG25', effectiveDate: '2019-05-01', state: 'DE' }] },
};

/** Fake seam: records every facade call with its options, answers from a per-tool script. */
function backend(answer: (patentNumber: string) => object = () => summary) {
	const calls: { path: string; body: unknown; options: IPatentBackendRequestOptions | undefined }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl() { return ''; },
		getTrialModelKey(): never { throw new Error('Unused'); },
		get(): never { throw new Error('Unused'); },
		async post<T>(path: string, body: unknown, _token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body, options });
			return { success: true, data: answer((body as { patent_number: string }).patent_number) } as T;
		},
	};
	return { client, calls };
}

const logService = { trace: () => { } } as unknown as ILogService;

/** Let the watcher's lookup settle. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function watch(provider: PatentLinkPresentationProvider, link: string) {
	return provider.provideLinkPresentationWatcher(vscode.Uri.parse(link), CancellationToken.None);
}

describe('patent link presentation provider', () => {
	it('renders the resolved patent as a pill and shares one lookup per publication number', async () => {
		const { client, calls } = backend();
		const provider = new PatentLinkPresentationProvider(client, logService);
		const reader = watch(provider, READER_LINK);
		const google = watch(provider, GOOGLE_LINK);
		const loading = reader.presentation;
		await flush();

		expect({ loading, resolved: reader.presentation, sameFacts: google.presentation.title === reader.presentation.title, calls }).toEqual({
			loading: { kind: 'resource', reference: 'EP1602570B1', status: { kind: 'pending', label: 'Loading' } },
			resolved: {
				kind: 'resource',
				reference: 'EP1602570B1',
				title: 'Fuel cell stack with cooling plates',
				detail: 'Ballard Power Systems Inc, Daimler AG',
				status: { kind: 'success', label: 'Granted' },
				secondaryStatus: { kind: 'warning', label: 'Lapsed in DE' },
				tooltip: 'EP1602570B1 · Fuel cell stack with cooling plates · Ballard Power Systems Inc, Daimler AG · Granted (from the kind code) · Lapsed in DE — INPADOC PG25 2019-05-01 (DE) · FlowLeap patent reader',
				ariaLabel: 'Patent EP1602570B1: Fuel cell stack with cooling plates',
			},
			sameFacts: true,
			calls: [{ path: '/tools/get_patent_summary', body: { patent_number: 'EP1602570B1' }, options: { silent: true } }],
		});
	});

	it('asks for nothing until the core requests a watcher', () => {
		const { client, calls } = backend();
		new PatentLinkPresentationProvider(client, logService);
		expect(calls).toEqual([]);
	});

	it('falls back to the bare publication number when the lookup fails, and retries the next time', async () => {
		let failures = 1;
		const { client, calls } = backend(() => {
			if (failures-- > 0) {
				throw new Error('offline');
			}
			return summary;
		});
		const provider = new PatentLinkPresentationProvider(client, logService);
		const failed = watch(provider, US_LINK);
		await flush();
		const afterFailure = failed.presentation;
		const retried = watch(provider, US_LINK);
		await flush();

		expect({ afterFailure, retriedTitle: retried.presentation.title, attempts: calls.length }).toEqual({
			afterFailure: { kind: 'resource', reference: 'US10958080B2' },
			retriedTitle: 'Fuel cell stack with cooling plates',
			attempts: 2,
		});
	});

	it('publishes nothing after the watcher is disposed', async () => {
		const { client } = backend();
		const provider = new PatentLinkPresentationProvider(client, logService);
		const watcher = watch(provider, READER_LINK);
		let changes = 0;
		watcher.onDidChangePresentation(() => changes++);
		watcher.dispose();
		await flush();
		expect({ changes, presentation: watcher.presentation.status }).toEqual({ changes: 0, presentation: { kind: 'pending', label: 'Loading' } });
	});

	it('reads only the legal-status codes that state an outcome by themselves', () => {
		const events = [
			{ code: 'PG25', effectiveDate: '2019-05-01', state: 'DE' },
			{ code: 'GBPC', date: '2020-01-01' },
			{ code: 'PGFP', date: '2016-03-01', state: 'FR' },
			{ code: '18W', date: '2011-02-02' },
			{ code: '18D', date: '2011-02-02' },
			{ code: 'MM4A', date: '2021-07-07' },
			{ code: '26N', date: '2009-01-01' },
			{ code: 'AK', date: '2005-12-12' },
		];
		expect(events.map(event => readPatentPillFacts('EP1602570B1', { legalStatus: { events: [event] } }).decisiveEvent?.status)).toEqual([
			{ kind: 'warning', label: 'Lapsed in DE' },
			{ kind: 'warning', label: 'Lapse recorded' },
			{ kind: 'success', label: 'Fee paid in FR' },
			{ kind: 'closed', label: 'Withdrawn' },
			{ kind: 'closed', label: 'Deemed withdrawn' },
			{ kind: 'warning', label: 'Lapsed, renewal fees unpaid' },
			undefined,
			undefined,
		]);
	});

	it('reads the kind code as the stage and says so when no event backs it', () => {
		const facts = readPatentPillFacts('EP1602570A1', { bibliography: { title: 'Published application', applicants: [] } });
		expect({
			pill: buildPatentPill(facts, 'espacenet'),
			stages: Object.fromEntries(['EP1602570A1', 'US10958080B2', 'DE202004012345U1', 'DE602004012345T2', 'US10958080'].map(number => [number, readKindStage(number)?.label])),
		}).toEqual({
			pill: {
				kind: 'resource',
				reference: 'EP1602570A1',
				title: 'Published application',
				status: { kind: 'open', label: 'Application' },
				tooltip: 'EP1602570A1 · Published application · Application (from the kind code) · No legal-status event this pill reads; run the legal-status tool for the full history · Espacenet link',
				ariaLabel: 'Patent EP1602570A1: Published application',
			},
			stages: { EP1602570A1: 'Application', US10958080B2: 'Granted', DE202004012345U1: 'Utility model', DE602004012345T2: 'Translation', US10958080: undefined },
		});
	});
});
