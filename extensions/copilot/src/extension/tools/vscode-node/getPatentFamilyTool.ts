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

interface IGetPatentFamilyParams {
	publicationNumber: string;
}

/**
 * One record of the extended INPADOC family, as returned by the `/tools/get_family` facade `data`
 * payload. A record is a publication, an application or a priority row (`refType`), so a single
 * family member appears several times. The DOCDB application fields the payload also carries
 * (`docdbApplication`, the deprecated `number`) are deliberately absent here: they read like a
 * filing number and are not one, so they must never reach the model as one.
 */
interface FamilyRecord {
	publication?: string;
	country?: string;
	kind?: string;
	date?: string;
	refType?: string;
}

/**
 * One family MEMBER — one application — with the single publication to cite for it: its first grant
 * where one exists, else its earliest publication. This is the grain a family question is asked at,
 * and the grain that stops a member that has granted from being reported under its pre-grant
 * publication. The backend applies the same rule on `get_patent_family` and on the PATSTAT graph,
 * so all three surfaces name the same number for the same member.
 */
interface FamilyMemberRepresentative {
	representativePublication?: string | null;
	isGrant?: boolean;
	publications?: string[];
}

interface FamilyData {
	docId: string;
	members: FamilyRecord[];
	representatives?: {
		members: FamilyMemberRepresentative[];
		rule?: string;
	};
}

/** What the model must know to read the member table without mistaking a publication for a member. */
const MEMBER_TABLE_GUIDANCE = 'One row per family MEMBER (one application), not one row per publication: a member that published several times is listed once. `Cite` is that member\'s representative publication — its first grant where one exists, else its earliest publication — so a member that has granted is named by its grant, and its pre-grant publication appears under `Also published as`. Answer "where was this filed or granted" from the `Cite` column: a pre-grant publication and a granted patent are different legal objects. `Grant` reads "no grant on record" when this family record holds no grant publication for the member, which is not evidence the application was refused or is still pending — for that use get_legal_status on the member, and get_register_events for EP prosecution history. An empty `Published` cell means EPO OPS returned no publication row for that number in this family, not that it never published.';

/** The same, for the degraded path where the backend served no member grouping. */
const RECORD_TABLE_GUIDANCE = 'These are raw family records, NOT members: the backend returned no member grouping for this family, so a member that published several times appears several times, and a member that has granted may be listed only under its pre-grant publication. Treat the count as publications, not as members, and confirm any member you report with get_legal_status before calling it granted or pending.';

/** `20100525` → `2010-05-25`; anything the family feed formats otherwise passes through unchanged. */
function formatFamilyDate(date: string | undefined): string {
	if (!date) {
		return '—';
	}
	const match = date.match(/^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})$/);
	return match?.groups ? `${match.groups.year}-${match.groups.month}-${match.groups.day}` : date;
}

/** Kind code of an epodoc publication number (`US7722129B2` → `B2`), or undefined when it carries none. */
function kindOfPublication(publication: string): string | undefined {
	return publication.match(/^[A-Z]{2}\d+(?<kind>[A-Z]\d?)$/)?.groups?.kind;
}

/**
 * Tool for retrieving a patent's EXTENDED INPADOC family — every application and publication linked
 * through common priorities, so the grants, divisionals and continuations of the same application as
 * well as the equivalents filed in other offices — from EPO OPS, through the FlowLeap agent-first
 * `/tools/get_family` facade. It reads the extended family and not the simple-family `/equivalents`
 * list (`/tools/get_patent_family`), because "where else was this filed OR GRANTED" is the question
 * asked of a family, and equivalents answer only "the same document, other office": they leave out
 * the grant an application issued as, which is a different legal object from its publication.
 * Routes through the shared {@link IPatentBackendClient} seam (via {@link callFacadeTool}), so it
 * inherits the centralized `401 → re-sign-in` / `402 → start-trial` / `429 → wait` gating. This is the
 * typed replacement for the raw `ops_api_guide` family endpoints in FTO / portfolio workflows.
 */
export class GetPatentFamilyTool implements ICopilotTool<IGetPatentFamilyParams> {

	public static readonly toolName = ToolName.GetPatentFamily;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IPatentExecutionLedger private readonly ledger: IPatentExecutionLedger,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetPatentFamilyParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching patent family for ${publicationNumber}...`,
		};
	}

	/**
	 * Normalize a publication number to the OPS epodoc format (US10000000B2). User input and search
	 * results may carry hyphens, dots, or spaces (US-10000000-B2); epodoc wants them stripped. Kind-code
	 * edge cases are handled server-side.
	 */
	private normalizePublicationNumber(pubNum: string): string {
		return pubNum.replace(/[-.\s/]/g, '').toUpperCase();
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentFamilyParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetPatentFamilyTool] Invoking patent-family fetch');

		const { publicationNumber } = options.input;
		const doc = this.normalizePublicationNumber(publicationNumber);
		this.logService.info(`[GetPatentFamilyTool] Normalized: ${publicationNumber} -> ${doc}`);

		try {
			const data = await callFacadeTool<FamilyData>(this.patentBackendClient, 'get_family', { patent_number: doc }, token);
			const formatted = this.formatFamily(data, doc);
			this.logService.info(`[GetPatentFamilyTool] Formatted response length: ${formatted.length} chars`);
			// The members are the jurisdictions a memo clears or leaves out, so they are recorded by
			// their own publication numbers, not only counted. Recorded for the audit only.
			const members = data.representatives?.members ?? [];
			const records = data.members ?? [];
			await this.ledger.record(options.chatSessionResource, {
				kind: 'status', status: 'succeeded', tool: 'get_patent_family', request: doc,
				rowCount: members.length || records.length,
				publicationIds: this.recordedPublications(doc, members, records),
				resultText: formatted,
			});
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			await this.ledger.record(options.chatSessionResource, { kind: 'status', status: token.isCancellationRequested ? 'cancelled' : 'failed', tool: 'get_patent_family', request: doc });
			return handlePatentToolError(error, this.logService, '[GetPatentFamilyTool]', err => `Error fetching patent family for ${publicationNumber}: ${err.status} - ${err.message}`);
		}
	}

	/**
	 * The publication numbers the audit trail keeps for this call: the requested document, then each
	 * member's citable publication, then the rest of its publications. The extended family names the
	 * same document on a publication, an application and a priority row, so the list is deduplicated —
	 * an audit row reading `US7722129B2` three times says nothing more than one reading it once.
	 */
	private recordedPublications(doc: string, members: readonly FamilyMemberRepresentative[], records: readonly FamilyRecord[]): string[] {
		const fromMembers = members.flatMap(member => [member.representativePublication, ...(member.publications ?? [])]);
		const fromRecords = records.map(record => record.publication);
		const all = [doc, ...(members.length > 0 ? fromMembers : fromRecords)];
		return [...new Set(all.filter((publication): publication is string => !!publication))];
	}

	private formatFamily(data: FamilyData, doc: string): string {
		const records = data.members ?? [];
		const members = data.representatives?.members ?? [];
		const lines: string[] = [
			`# Patent Family: ${data.docId || doc}`,
			'',
		];

		if (records.length === 0 && members.length === 0) {
			lines.push('No INPADOC family members found for this publication number.');
			lines.push('');
			lines.push('EPO OPS may not hold family data for this document. Verify the number with get_patent_details, or the patent may have no family members beyond itself.');
			return lines.join('\n');
		}

		// Only publication rows carry a publication date; the date on an application or priority row is
		// that filing's date, and printing it under "Published" would be a different fact.
		const publicationDates = new Map<string, string>();
		for (const record of records) {
			if (record.refType === 'publication' && record.publication && record.date) {
				publicationDates.set(record.publication, record.date);
			}
		}

		if (members.length === 0) {
			const distinctRecords = new Map<string, FamilyRecord>();
			for (const record of records) {
				if (record.publication && !distinctRecords.has(record.publication)) {
					distinctRecords.set(record.publication, record);
				}
			}
			lines.push(`INPADOC family records: ${distinctRecords.size} publication(s), from ${records.length} row(s).`);
			lines.push('');
			lines.push(renderMarkdownTable([...distinctRecords.values()], [
				{ header: 'Country', cell: r => r.country || (r.publication ? r.publication.substring(0, 2) : '—') },
				{ header: 'Publication', cell: r => r.publication || '—' },
				{ header: 'Kind', cell: r => (r.publication && kindOfPublication(r.publication)) || r.kind || '—' },
				{ header: 'Published', cell: r => formatFamilyDate(publicationDates.get(r.publication || '')) },
			]));
			lines.push('');
			lines.push(RECORD_TABLE_GUIDANCE);
			return lines.join('\n');
		}

		lines.push(`Extended INPADOC family: ${members.length} member(s), from ${records.length} family record(s).`);
		lines.push('');
		lines.push(renderMarkdownTable(members, [
			{ header: 'Country', cell: m => m.representativePublication ? m.representativePublication.substring(0, 2) : '—' },
			{ header: 'Cite', cell: m => m.representativePublication || '—' },
			{ header: 'Kind', cell: m => (m.representativePublication && kindOfPublication(m.representativePublication)) || '—' },
			{ header: 'Grant', cell: m => m.isGrant ? 'granted' : 'no grant on record' },
			{ header: 'Published', cell: m => formatFamilyDate(publicationDates.get(m.representativePublication || '')) },
			{ header: 'Also published as', cell: m => (m.publications ?? []).filter(publication => publication !== m.representativePublication).join(', ') || '—' },
		]));
		lines.push('');
		lines.push(MEMBER_TABLE_GUIDANCE);
		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetPatentFamilyTool);
