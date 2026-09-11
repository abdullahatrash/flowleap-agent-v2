/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { evidenceAnchor, IPatentExecutionLedger, PatentEvidenceSource } from '../../patentai/vscode-node/patentExecutionLedger';
import { parsePatentDocumentReference, PatentDocumentReference } from '../../patentai/common/patentDocumentReference';
import { patentCitationLink } from '../../patentai/vscode-node/patentCitationLink';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError } from '../../patentai/vscode-node/patentBackendClient';
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

import { lookupPatentEvidence, PatentEvidenceLookup } from './patentEvidenceLookup';

/** Beyond this many cited references the list is elided: the closest art sits at the head of a search report. */
const maxCitedReferences = 40;

interface IGetPatentDetailsParams {
	publicationNumber: string;
	evidenceLookup?: PatentEvidenceLookup;
}

/**
 * One entry of a publication's cited-references list — the references printed on its search report
 * or filed by the applicant. An examiner-cited X or Y entry is the closest art on record.
 */
interface CitedReference {
	docId: string;
	kind?: string;
	date?: string;
	citedBy: 'applicant' | 'examiner' | 'unknown';
	phase?: string;
	category?: string;
	relevantClaims?: string;
	relevantPassages?: string[];
	npl?: string;
}

/** `data` payload of the `get_bibliography` facade tool. */
interface BiblioData {
	documentReference?: PatentDocumentReference | null;
	docId: string;
	title: string | null;
	abstract: string | null;
	applicants: string[];
	inventors: string[];
	ipc: string[];
	cpc: string[];
	dates: {
		filing: string | null;
		publication: string | null;
		priority: string[];
	};
	citedReferences?: CitedReference[];
}

/** `data` payload of the `get_claims` facade tool — numbered claims, not bare strings. */
interface ClaimsData {
	documentReference?: PatentDocumentReference | null;
	docId: string;
	claims: { number: string; text: string; documentReference?: PatentDocumentReference | null }[];
	totalClaims: number | null;
	unsegmentedText?: string;
	language: string;
}

/** `data` payload of the `get_description` facade tool. */
interface DescriptionData {
	documentReference?: PatentDocumentReference | null;
	docId: string;
	description: string | null;
	language: string;
}

/**
 * Tool for retrieving full patent details (bibliographic data + claims + description) through the
 * FlowLeap backend's `/v1/tools` facade — `get_bibliography`, `get_claims`, `get_description` — via
 * the shared {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating.
 *
 * The facade routes full text per office (EP/WO through EPO OPS, US claims through BigQuery), so a
 * missing section is a structured verdict rather than a coverage assumption; a section that fails
 * degrades to the fallback line instead of failing the whole tool.
 */
export class GetPatentDetailsTool implements ICopilotTool<IGetPatentDetailsParams> {

	public static readonly toolName = ToolName.GetPatentDetails;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IPatentExecutionLedger private readonly ledger: IPatentExecutionLedger,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetPatentDetailsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: options.input.evidenceLookup
				? l10n.t`Reading stored patent evidence for ${publicationNumber}...`
				: l10n.t`Fetching patent details for ${publicationNumber}...`,
		};
	}

	/**
	 * Normalize a publication number to the OPS epodoc format (US10000000B2). Search results and
	 * user input may carry hyphens, dots, or spaces (US-10000000-B2); epodoc wants them stripped.
	 * Kind-code edge cases are handled server-side by cleanDocumentId.
	 */
	private normalizePublicationNumber(pubNum: string): string {
		return pubNum.replace(/[-.\s/]/g, '').toUpperCase();
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentDetailsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetPatentDetailsTool] Invoking patent details fetch');

		const { publicationNumber } = options.input;
		const doc = this.normalizePublicationNumber(publicationNumber);
		this.logService.info(`[GetPatentDetailsTool] Normalized: ${publicationNumber} -> ${doc}`);

		if (options.input.evidenceLookup) {
			return new LanguageModelToolResult([new LanguageModelTextPart(lookupPatentEvidence(await this.ledger.read(options.chatSessionResource), doc, options.input.evidenceLookup))]);
		}

		try {
			const biblioPromise = callFacadeTool<BiblioData>(this.patentBackendClient, 'get_bibliography', { patent_number: doc }, token);
			const claimsPromise = this.fetchOptionalSection<ClaimsData>('get_claims', doc, token);
			const descriptionPromise = this.fetchOptionalSection<DescriptionData>('get_description', doc, token);

			const biblio = await biblioPromise;
			const searchReport = await this.fetchSearchReportCitations(biblio, doc, token);
			const [claims, description] = await Promise.all([claimsPromise, descriptionPromise]);

			const sources: PatentEvidenceSource[] = [];
			const addSource = (value: PatentDocumentReference | null | undefined, language?: string, unsegmented = false, text?: string) => {
				const reference = parsePatentDocumentReference(value);
				if (reference) { sources.push({ anchor: evidenceAnchor(reference, language), reference, language, text, retrieval: unsegmented ? 'unsegmented' : 'returned', review: 'unknown', completeness: 'unknown' }); }
			};
			addSource(biblio.documentReference, undefined, false, biblio.abstract ?? undefined);
			// Segmented claims win whenever the backend returns both: unsegmented text is the fallback
			// for a document whose claim numbers could not be established, not a replacement.
			const segmented = (claims?.claims.length ?? 0) > 0;
			if (claims && (segmented || claims.unsegmentedText)) {
				addSource(claims.documentReference, claims.language, !segmented, segmented ? claims.claims.map(claim => claim.text).join('\n\n') : claims.unsegmentedText);
				for (const claim of claims.claims) { addSource(claim.documentReference, claims.language, false, claim.text); }
			}
			if (description?.description) { addSource(description.documentReference, description.language, false, description.description); }
			const unavailableSections = [!claims?.claims.length && !claims?.unsegmentedText ? 'claims' : '', !description?.description ? 'description' : ''].filter(Boolean);
			const audit = await this.ledger.record(options.chatSessionResource, { kind: 'details', status: 'succeeded', publicationIds: [biblio.docId || doc], publicationTitle: biblio.title ?? undefined, publicationDate: biblio.dates?.publication ?? undefined, sources, unavailableSections, totalClaims: claims?.totalClaims ?? undefined, returnedClaims: claims?.claims.length });
			const formattedResponse = this.formatPatentDetails(biblio, claims, description, doc, searchReport);
			this.logService.info(`[GetPatentDetailsTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart('Evidence recovery: call get_patent_details with this publicationNumber and evidenceLookup: {} for the local anchor index; use evidenceLookup.query to find later passages or evidenceLookup.anchor and start to page through stored text. No repeated retrieval needed.\n\n' + formattedResponse + '\n\n' + audit)
			]);

		} catch (error) {
			const audit = await this.ledger.record(options.chatSessionResource, { kind: 'details', status: token.isCancellationRequested ? 'cancelled' : 'failed', publicationIds: [doc] });
			const result = handlePatentToolError(
				error,
				this.logService,
				'[GetPatentDetailsTool]',
				err => `Error fetching patent ${publicationNumber}: ${err.status} - ${err.message}`,
				err => err.status === 404 ? `\n\n${this.usptoFallbackHint(doc)}` : '',
			);
			return new LanguageModelToolResult([...result.content, new LanguageModelTextPart(audit)]);
		}
	}

	/**
	 * Fetch an optional full-text section through the facade. Full text is not published for every
	 * office and section, so a failure here must not fail the whole tool — return null and let the
	 * formatter point at the fallback. Cancellation still propagates, and so do the seam's typed
	 * gating errors: the same guards protect `get_bibliography`, so surfacing them once there is enough.
	 */
	/**
	 * EPO attaches search-report citations to the A3 publication, so an A1/A2 or B1 record carries
	 * none (verified live 2026-09-11). A live run showed the model ignoring a pointer to the A3, so the
	 * tool fetches that record itself; the cost is one cached bibliography read per EP retrieval.
	 */
	private async fetchSearchReportCitations(biblio: BiblioData, doc: string, token: CancellationToken): Promise<{ readonly docId: string; readonly references: readonly CitedReference[] } | undefined> {
		if (biblio.citedReferences?.length) { return undefined; }
		const ep = /^EP(?<number>\d+)\.?(?:A[12]|B\d)$/i.exec(biblio.docId || doc);
		if (!ep) { return undefined; }
		const a3 = `EP${ep.groups?.number}A3`;
		const report = await this.fetchOptionalSection<BiblioData>('get_bibliography', a3, token);
		return report?.citedReferences?.length ? { docId: a3, references: report.citedReferences } : undefined;
	}

	private async fetchOptionalSection<T>(toolName: string, doc: string, token: CancellationToken): Promise<T | null> {
		try {
			return await callFacadeTool<T>(this.patentBackendClient, toolName, { patent_number: doc }, token);
		} catch (error) {
			if (error instanceof PatentBackendError && error.message === 'Request cancelled.') {
				throw error;
			}
			this.logService.info(`[GetPatentDetailsTool] Optional section ${toolName} unavailable for ${doc}: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}

	private usptoFallbackHint(doc: string): string {
		return `For a US document, the full file wrapper is available from the USPTO: use get_us_grant with the bare numeric patent number (${doc.replace(/^US/, '').replace(/[A-Z]\d?$/, '')}), or search_patents with provider="uspto".`;
	}

	/**
	 * Render the cited-references block, or nothing when the bibliography carries no usable entry.
	 * The block ends with a blank line so the caller can splice it between two existing sections.
	 */
	private formatCitedReferences(references: readonly CitedReference[], docId: string, origin = `from this publication's bibliography`): string[] {
		const entries = references.map(formatCitedReference).filter((line): line is string => !!line);
		if (entries.length === 0) {
			// The A3 lookup above already failed or returned nothing; say where citations live so the
			// absence is not read as "none exist".
			const ep = /^EP\d+\.?(?<kind>A[12]|B\d)$/i.exec(docId);
			return ep ? ['', `**Cited references:** none on this ${ep.groups?.kind} publication, and the ${docId.replace(/\.?(A[12]|B\d)$/i, '')}A3 search-report record returned none or was unavailable.`] : [];
		}
		const shown = entries.slice(0, maxCitedReferences);
		return [
			`## Cited references (${origin})`,
			'Examiner-cited X/Y entries are the closest art on record for this document. Retrieve only the in-scope, pre-cutoff ones, one at a time, and read each with evidenceLookup before retrieving the next; a retrieved document that is never cited is disclosed in the report as unreviewed.',
			...shown,
			...(entries.length > shown.length ? [`… and ${entries.length - shown.length} more`] : []),
			'',
		];
	}

	/**
	 * Format patent details for LLM consumption
	 */
	private formatPatentDetails(biblio: BiblioData, claims: ClaimsData | null, description: DescriptionData | null, doc: string, searchReport?: { readonly docId: string; readonly references: readonly CitedReference[] }): string {
		const countryCode = biblio.docId?.substring(0, 2) || doc.substring(0, 2);
		const fulltextFallback = `Full text is not available for this document and section. ${this.usptoFallbackHint(doc)}`;

		const anchorLabel = (value: PatentDocumentReference | null | undefined, language?: string) => {
			const reference = parsePatentDocumentReference(value);
			return reference ? ` [source anchor: ${evidenceAnchor(reference, language)}]` : '';
		};
		const lines: string[] = [
			`# Patent: ${patentCitationLink(biblio.docId || doc, biblio.documentReference)}`,
			'',
			`**Title:** ${biblio.title || 'N/A'}`,
			`**Country:** ${countryCode}`,
			`**Filing Date:** ${biblio.dates?.filing || 'N/A'}`,
			`**Publication Date:** ${biblio.dates?.publication || 'N/A'}`,
			`**Priority Date(s):** ${biblio.dates?.priority?.length > 0 ? biblio.dates.priority.join(', ') : 'N/A'}`,
			'',
			`**Applicants:** ${biblio.applicants?.length > 0 ? biblio.applicants.join(', ') : 'N/A'}`,
			`**Inventors:** ${biblio.inventors?.length > 0 ? biblio.inventors.join(', ') : 'N/A'}`,
			'',
			`**IPC Classifications:** ${biblio.ipc?.length > 0 ? biblio.ipc.join(', ') : 'N/A'}`,
			`**CPC Classifications:** ${biblio.cpc?.length > 0 ? biblio.cpc.join(', ') : 'N/A'}`,
			'',
			...(searchReport ? this.formatCitedReferences(searchReport.references, searchReport.docId, `from the ${searchReport.docId} search report`) : this.formatCitedReferences(biblio.citedReferences ?? [], biblio.docId || doc)),
			`## Abstract${anchorLabel(biblio.documentReference)}`,
			biblio.abstract || 'No abstract available.',
			'',
			`## ${patentCitationLink('Claims', claims?.documentReference)}${anchorLabel(claims?.documentReference, claims?.language)}`,
			// Numbered claims are citable and unsegmented text is not, so prefer them whenever both arrive.
			claims && claims.claims.length > 0 ? claims.claims.map(c => `${patentCitationLink(`Claim ${c.number}`, c.documentReference)}${anchorLabel(c.documentReference, claims.language)}\n${c.text}`).join('\n\n') : claims?.unsegmentedText ? `Individual claim numbers could not be established. Cite the claims section only.\n\n${claims.unsegmentedText}` : fulltextFallback,
			'',
			`## ${patentCitationLink('Description', description?.documentReference)}`,
			description?.description ? description.description.split(/\r?\n/).map(line => line.trim() ? `${anchorLabel(description.documentReference, description.language).trim()} ${line}` : '').join('\n') : fulltextFallback,
			'',
			'---',
			'For citations use search_citations / search_forward_citations; for the patent family use get_patent_family.',
		];

		return lines.join('\n');
	}
}

/** `19941018` in bibliographic data, `1994-10-18` everywhere a reader looks; anything else is passed through. */
function formatCitedDate(date: string | undefined): string | undefined {
	const value = date?.trim();
	if (!value) {
		return undefined;
	}
	const match = /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})$/.exec(value);
	return match ? `${match.groups!.year}-${match.groups!.month}-${match.groups!.day}` : value;
}

/** Strip the `* ... *` decoration wrapped around a relevant passage in the source record. */
function formatCitedPassage(passage: string): string {
	return passage.replace(/^[\s*]+/, '').replace(/[\s*]+$/, '');
}

/** One rendered bullet, or undefined for an entry that names neither a document nor a non-patent reference. */
function formatCitedReference(reference: CitedReference): string | undefined {
	const label = reference.npl?.trim() ? `[NPL] ${reference.npl.trim()}` : reference.docId?.trim();
	if (!label) {
		return undefined;
	}
	const qualifiers = [reference.kind?.trim(), formatCitedDate(reference.date)].filter(Boolean);
	const facts = [
		reference.citedBy || 'unknown',
		reference.phase?.trim(),
		reference.category?.trim() ? `category ${reference.category.trim()}` : '',
		reference.relevantClaims?.trim() ? `claims ${reference.relevantClaims.trim()}` : '',
	].filter(Boolean);
	const passages = (reference.relevantPassages ?? []).map(formatCitedPassage).filter(Boolean);
	return `- ${label}${qualifiers.length ? ` (${qualifiers.join(', ')})` : ''} — ${facts.join(', ')}${passages.length ? `; passages: ${passages.join('; ')}` : ''}`;
}

ToolRegistry.registerTool(GetPatentDetailsTool);
