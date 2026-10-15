/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { IPatentExecutionLedger } from '../../patentai/vscode-node/patentExecutionLedger';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';
import { renderMarkdownTable } from './patentResponseFormatter';

interface ISearchRegisterParams {
	query: string;
	range?: string;
}

/** A party named on an EP Register record: a representative (agent of record) or an opponent. */
interface RegisterParty {
	name: string | null;
	country?: string | null;
}

/** One EP application's register record, as the `/tools/search_register` facade `data.docs` lists it. */
interface RegisterDoc {
	/** The earliest EP publication of the application, or null while none is published. */
	docId: string | null;
	applicationNumber: string | null;
	applicants?: string[];
	representatives?: RegisterParty[];
	opponents?: RegisterParty[];
	status?: string | null;
	title?: string | null;
}

/** `data` payload of the `search_register` facade tool. */
interface RegisterSearchData {
	/** OPS's count for the whole query, capped at 10000. */
	total?: number;
	/** Rows on this page. */
	returned?: number;
	range?: {
		begin: number;
		end: number;
	};
	docs?: RegisterDoc[];
	/** Backend guidance on a zero-result role-index query, e.g. retry with `nm=` (optional). */
	hint?: string;
}

/** The range the backend applies when the model gives none. */
const DEFAULT_RANGE = '1-25';

/** Render the parties of one register record as `Name (CC); Name (CC)`, or `—` when there are none. */
function partyLabel(parties: RegisterParty[] | undefined): string {
	const labels = (parties ?? [])
		.filter(party => party.name)
		.map(party => party.country ? `${party.name} (${party.country})` : `${party.name}`);
	return labels.length > 0 ? labels.join('; ') : '—';
}

/**
 * Tool for searching the EP Register with register CQL through the FlowLeap agent-first
 * `/tools/search_register` facade. The EP Register is the one search with a representative index:
 * `re=` is the professional representative (agent) of record, `op=` an opponent and `nm=` a name in
 * any role (the fallback when a role index returns 0; the register stores names surname-first). Routes through
 * the shared {@link IPatentBackendClient} seam (via {@link callFacadeTool}), so it inherits the
 * centralized `401 → re-sign-in` / `402 → start-trial` / `429 → wait` gating. EP applications only.
 */
export class SearchRegisterTool implements ICopilotTool<ISearchRegisterParams> {

	public static readonly toolName = ToolName.SearchRegister;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IPatentExecutionLedger private readonly ledger: IPatentExecutionLedger,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchRegisterParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { query } = options.input;
		return {
			invocationMessage: l10n.t`Searching the EP Register for ${query}...`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchRegisterParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[SearchRegisterTool] Invoking EP Register search');

		const { query, range = DEFAULT_RANGE } = options.input;

		try {
			const data = await callFacadeTool<RegisterSearchData>(this.patentBackendClient, 'search_register', { query, range }, token);
			const docs = data.docs ?? [];
			// A representative or opponent count stated in a memo comes from this total; the record is
			// what the stated count is checked against. An application with no publication yet is
			// recorded by its application number, the only id the register gives it.
			const audit = await this.ledger.record(options.chatSessionResource, {
				kind: 'search', status: 'succeeded', query, requestedRange: range,
				total: data.total, returned: data.returned ?? docs.length, range: data.range,
				publicationIds: docs.flatMap(doc => doc.docId ?? doc.applicationNumber ?? []),
			});
			const formatted = this.formatRegisterSearch(data, query);
			this.logService.info(`[SearchRegisterTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(formatted),
				new LanguageModelTextPart(audit),
			]);
		} catch (error) {
			const audit = await this.ledger.record(options.chatSessionResource, { kind: 'search', status: token.isCancellationRequested ? 'cancelled' : 'failed', query, requestedRange: range });
			const result = handlePatentToolError(error, this.logService, '[SearchRegisterTool]', err => `Error: EP Register search backend returned ${err.status} - ${err.message}`);
			return new LanguageModelToolResult([...result.content, new LanguageModelTextPart(audit)]);
		}
	}

	private formatRegisterSearch(data: RegisterSearchData, query: string): string {
		const docs = data.docs ?? [];
		const lines: string[] = [
			`# EP Register Search: ${query}`,
			'',
		];

		if (docs.length === 0) {
			lines.push('No EP Register records match this query.');
			if (data.hint) {
				lines.push(data.hint);
			}
			lines.push('');
			lines.push('The EP Register covers EP applications only. Register indexes: re (representative), op (opponent), nm (a name in any role), ia (inventor or applicant), pa, in, ti, pn, ap, pr, pd, ic. Not register indexes: ag, rep, ab, cpc, st, ps, fd, ctr. A role index that returns 0 does not mean the name is absent: retry with nm=<surname> to find which role the person holds. Names are surname-first: nm="Surname, First", not nm="First Surname". Quote a multi-word value: re="Muster Patentanwälte". See get_search_syntax provider=epo_register.');
			return lines.join('\n');
		}

		const total = data.total ?? docs.length;
		const shown = data.range ? `${data.range.begin}-${data.range.end}` : `1-${docs.length}`;
		lines.push(`${total} EP application(s) match this register query (OPS total for the whole query, capped at 10000). Showing results ${shown} in register order.`);
		lines.push('');
		lines.push(renderMarkdownTable(docs, [
			{ header: 'Publication', cell: doc => doc.docId || '— (not yet published)' },
			{ header: 'Application', cell: doc => doc.applicationNumber || '—' },
			{ header: 'Representative', cell: doc => partyLabel(doc.representatives) },
			{ header: 'Status', cell: doc => doc.status || '—' },
			{ header: 'Applicant', cell: doc => doc.applicants?.length ? doc.applicants.join('; ') : '—' },
			{ header: 'Title', cell: doc => doc.title || '—' },
		]));
		lines.push('');
		if (data.hint) {
			lines.push(data.hint);
			lines.push('');
		}
		lines.push('The EP Register covers EP applications only, so a representative or opponent count from here is EP-only: say so. Report the total as the count and the rows as examples. Rows arrive in register order, not by relevance. For the register record of one application use get_register_biblio (ops_api_guide); for its event chronology use get_register_events.');
		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchRegisterTool);
