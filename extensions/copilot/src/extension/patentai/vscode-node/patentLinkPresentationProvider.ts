/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { callFacadeTool } from '../../tools/vscode-node/patentFacade';
import { PatentLinkTarget, recognizePatentLink } from '../common/patentLinkTarget';
import { IPatentBackendClient } from './patentBackendClient';

/**
 * The provider id declared in `contributes.linkPresentationProviders`. The core selects the provider
 * by this id and activates the extension through `onLinkPresentation:<id>`, so the manifest and this
 * constant must stay in step (a test asserts they do).
 */
export const PATENT_LINK_PRESENTATION_PROVIDER_ID = 'flowleap.patentLinkPresentations';

/**
 * The single kind this provider produces. The core drops a presentation whose kind differs from the
 * kind declared in the manifest, so every pill built here — loading, resolved, or un-enriched —
 * carries this one.
 */
const PILL_KIND = 'resource';

/** Backend tool that answers biblio, applicants and legal status in one round-trip. */
const SUMMARY_TOOL = 'get_patent_summary';

/** Applicants shown on the pill before it degrades to "+N more". */
const MAX_APPLICANTS = 2;

/**
 * Publications whose lookup is kept. A reader moving through a long report opens links faster than
 * legal status changes, so the cache is generous; the oldest entry goes when it is full, which is
 * enough for a session and stops an all-day window from growing without a bound.
 */
const MAX_CACHED_LOOKUPS = 200;

/** INPADOC codes that record a lapse for non-payment of renewal fees, across offices. */
const RENEWAL_LAPSE_CODES = new Set(['MM4A', 'MM4D', 'MM9A', 'MM9D']);

/** One INPADOC legal-status event, as the `get_patent_summary` payload carries it. */
interface LegalEvent {
	readonly code?: string | null;
	readonly date?: string | null;
	readonly effectiveDate?: string | null;
	readonly state?: string | null;
}

/** The fields this pill reads out of the `get_patent_summary` `data` payload; everything else is ignored. */
interface SummaryPayload {
	readonly bibliography?: { readonly title?: string | null; readonly applicants?: readonly string[] | null } | null;
	readonly legalStatus?: { readonly events?: readonly LegalEvent[] | null } | null;
}

/** What one backend lookup contributes to a pill. */
export interface PatentPillFacts {
	readonly publicationNumber: string;
	readonly title?: string;
	readonly applicants: readonly string[];
	/** The latest legal-status event whose code this pill is willing to read, if any. */
	readonly decisiveEvent?: { readonly status: vscode.LinkPresentationStatus; readonly provenance: string };
}

/**
 * Reads the publication kind code as the document's stage. This is a fact of the number itself — `B`
 * is a grant publication at every office, `A` is an application publication — so it is available
 * without judgement and stays right whatever the event history says. Kinds outside this set (`C`
 * reexamination certificates, office-specific letters) read as nothing rather than as a guess.
 */
export function readKindStage(publicationNumber: string): vscode.LinkPresentationStatus | undefined {
	switch (/^[A-Z]{2}\d{4,16}(?<kind>[A-Z])\d?$/.exec(publicationNumber)?.groups?.kind) {
		case 'A': return { kind: 'open', label: l10n.t('Application') };
		case 'B': return { kind: 'success', label: l10n.t('Granted') };
		case 'U': return { kind: 'neutral', label: l10n.t('Utility model') };
		case 'T': return { kind: 'neutral', label: l10n.t('Translation') };
		default: return undefined;
	}
}

/**
 * Reads ONE legal-status event as a status, from a deliberately tiny whitelist of INPADOC codes that
 * state an outcome by themselves: a post-grant lapse (`PG25`, or a national cessation code such as
 * `GBPC`), a renewal-fee payment (`PGFP`), a withdrawal (`18W`/`18D`), or a lapse for unpaid renewal
 * fees (`MM4A` and friends). Every other code says something the pill is not able to conclude from —
 * the same rule the legal-status tool applies — so it reads as nothing. A pill must never invent
 * "in force": that verdict needs the whole fee history, which this one round-trip does not carry.
 */
export function readEventStatus(event: LegalEvent): vscode.LinkPresentationStatus | undefined {
	const code = (event.code ?? '').toUpperCase();
	const state = event.state?.toUpperCase();
	if (code === 'PG25' || (code.length > 2 && code.endsWith('PC'))) {
		return { kind: 'warning', label: state ? l10n.t('Lapsed in {0}', state) : l10n.t('Lapse recorded') };
	}
	if (code === 'PGFP') {
		return { kind: 'success', label: state ? l10n.t('Fee paid in {0}', state) : l10n.t('Renewal fee paid') };
	}
	if (code === '18W') {
		return { kind: 'closed', label: l10n.t('Withdrawn') };
	}
	if (code === '18D') {
		return { kind: 'closed', label: l10n.t('Deemed withdrawn') };
	}
	if (RENEWAL_LAPSE_CODES.has(code)) {
		return { kind: 'warning', label: l10n.t('Lapsed, renewal fees unpaid') };
	}
	return undefined;
}

/** The date an event is ordered by: the national effective date when the backend attached one. */
function eventDate(event: LegalEvent): string {
	return event.effectiveDate || event.date || '';
}

/** Read the summary payload into the facts a pill renders, keeping the provenance of each reading. */
export function readPatentPillFacts(publicationNumber: string, summary: SummaryPayload): PatentPillFacts {
	const title = summary.bibliography?.title?.trim();
	const applicants = (summary.bibliography?.applicants ?? []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
	let decisive: PatentPillFacts['decisiveEvent'];
	let decisiveDate = '';
	for (const event of summary.legalStatus?.events ?? []) {
		const status = readEventStatus(event);
		const date = eventDate(event);
		if (status && (!decisive || date >= decisiveDate)) {
			decisive = {
				status,
				// Provenance, not prose: the INPADOC code, its date and the state it applies to, so a
				// reader can check the pill's reading against the legal-status tool's own event table.
				provenance: `INPADOC ${(event.code ?? '').toUpperCase()}${date ? ` ${date}` : ''}${event.state ? ` (${event.state})` : ''}`,
			};
			decisiveDate = date;
		}
	}
	return { publicationNumber, ...(title ? { title } : {}), applicants, ...(decisive ? { decisiveEvent: decisive } : {}) };
}

/** The pill shown while the lookup runs: the number the link resolves to, and nothing asserted yet. */
export function buildLoadingPatentPill(publicationNumber: string): vscode.LinkPresentationData {
	return {
		kind: PILL_KIND,
		reference: publicationNumber,
		status: { kind: 'pending', label: l10n.t('Loading') },
	};
}

/**
 * The pill shown when the lookup cannot answer — offline, cancelled, or a typed `401`/`402`/`429`
 * from the backend seam. It carries the publication number and nothing else: no error status, no
 * tooltip, and (because the request runs `silent`) no notification. The proposed API has no way to
 * withdraw a pill once its URI pattern matched, so this is as close to the plain link as a provider
 * can get.
 */
export function buildUnenrichedPatentPill(publicationNumber: string): vscode.LinkPresentationData {
	return { kind: PILL_KIND, reference: publicationNumber };
}

/** The resolved pill: title, applicant, the kind-code stage, and the one legal event that reads. */
export function buildPatentPill(facts: PatentPillFacts, source: PatentLinkTarget['source']): vscode.LinkPresentationData {
	const stage = readKindStage(facts.publicationNumber);
	const detail = applicantLabel(facts.applicants);
	const tooltip = [
		facts.publicationNumber,
		facts.title,
		detail,
		stage ? l10n.t('{0} (from the kind code)', stage.label) : undefined,
		facts.decisiveEvent ? `${facts.decisiveEvent.status.label} — ${facts.decisiveEvent.provenance}` : l10n.t('No legal-status event this pill reads; run the legal-status tool for the full history'),
		sourceLabel(source),
	].filter((value): value is string => !!value).join(' · ');
	return {
		kind: PILL_KIND,
		reference: facts.publicationNumber,
		...(facts.title ? { title: facts.title } : {}),
		...(detail ? { detail } : {}),
		...(stage ? { status: stage } : {}),
		...(facts.decisiveEvent ? { secondaryStatus: facts.decisiveEvent.status } : {}),
		tooltip,
		ariaLabel: l10n.t('Patent {0}: {1}', facts.publicationNumber, facts.title || l10n.t('no title on record')),
	};
}

function applicantLabel(applicants: readonly string[]): string | undefined {
	if (!applicants.length) {
		return undefined;
	}
	const shown = applicants.slice(0, MAX_APPLICANTS).join(', ');
	return applicants.length > MAX_APPLICANTS ? l10n.t('{0} +{1} more', shown, applicants.length - MAX_APPLICANTS) : shown;
}

/** Names the surface the link pointed at, so a reader can tell a reader link from an external one. */
function sourceLabel(source: PatentLinkTarget['source']): string {
	switch (source) {
		case 'reader': return l10n.t('FlowLeap patent reader');
		case 'googlePatents': return l10n.t('Google Patents link');
		case 'espacenet': return l10n.t('Espacenet link');
		case 'uspto': return l10n.t('USPTO link');
	}
}

/**
 * Renders patent links — the reader's own citations and Espacenet / Google Patents / USPTO URLs — as
 * pills carrying the title, the applicant and what the legal-status events say, fetched through the
 * shared {@link IPatentBackendClient} seam.
 *
 * No lookup runs until the core asks for a watcher, which it only does for a link in a document the
 * user has open, and the results are shared per publication number for the provider's lifetime: two
 * citations of the same patent (or the same one in two reports) cost one round-trip. A failed lookup
 * is dropped from that cache, so reopening the document after coming back online retries.
 */
export class PatentLinkPresentationProvider implements vscode.LinkPresentationProvider {

	private readonly _lookups = new Map<string, Promise<PatentPillFacts>>();

	constructor(
		private readonly _client: IPatentBackendClient,
		private readonly _logService: ILogService,
	) { }

	provideLinkPresentationWatcher(resource: vscode.Uri, _token: vscode.CancellationToken): vscode.LinkPresentationWatcher {
		return new PatentLinkPresentationWatcher(
			recognizePatentLink(resource.toString(true)),
			publicationNumber => this._lookup(publicationNumber),
			message => this._logService.trace(`[PatentLinkPresentation] ${message}`),
		);
	}

	/** One in-flight (and then resolved) lookup per publication number; failures are not kept. */
	private _lookup(publicationNumber: string): Promise<PatentPillFacts> {
		const pending = this._lookups.get(publicationNumber);
		if (pending) {
			return pending;
		}
		const lookup = this._fetch(publicationNumber);
		this._lookups.set(publicationNumber, lookup);
		// A failure is not an answer: drop it so the next reader of the same patent retries rather
		// than inheriting an offline moment for the rest of the session.
		void lookup.catch(() => {
			if (this._lookups.get(publicationNumber) === lookup) {
				this._lookups.delete(publicationNumber);
			}
		});
		while (this._lookups.size > MAX_CACHED_LOOKUPS) {
			const oldest = this._lookups.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this._lookups.delete(oldest);
		}
		return lookup;
	}

	private async _fetch(publicationNumber: string): Promise<PatentPillFacts> {
		// `silent`: this request is background decoration for a document the user just opened, so the
		// seam's actionable sign-in / subscribe / add-keys notifications must not fire behind it. The
		// typed errors still throw, and the pill degrades to the plain publication number.
		const summary = await callFacadeTool<SummaryPayload>(
			this._client,
			SUMMARY_TOOL,
			{ patent_number: publicationNumber },
			CancellationToken.None,
			{ silent: true },
		);
		return readPatentPillFacts(publicationNumber, summary);
	}
}

/**
 * One link's live presentation. Starts on the loading pill, then either the resolved pill or the
 * un-enriched one; a watcher disposed while its lookup is in flight publishes nothing further.
 *
 * The lookup itself is shared through the provider's cache and therefore NOT cancelled on dispose:
 * one small POST is cheaper than re-issuing it for the next reader of the same patent.
 */
class PatentLinkPresentationWatcher implements vscode.LinkPresentationWatcher {

	private readonly _onDidChangePresentation = new vscode.EventEmitter<void>();
	readonly onDidChangePresentation = this._onDidChangePresentation.event;

	private _presentation: vscode.LinkPresentationData;
	private _disposed = false;

	get presentation(): vscode.LinkPresentationData {
		return this._presentation;
	}

	constructor(
		target: PatentLinkTarget | undefined,
		lookup: (publicationNumber: string) => Promise<PatentPillFacts>,
		trace: (message: string) => void,
	) {
		// A URI that passed the manifest's pattern but carries no readable publication number (a
		// classic Espacenet query with an unexpected shape, say) gets the bare pill rather than an
		// error one: the core cannot be told "never mind", and a loud failure would be wrong here.
		this._presentation = target ? buildLoadingPatentPill(target.publicationNumber) : { kind: PILL_KIND };
		if (target) {
			void this._resolve(target, lookup, trace);
		}
	}

	dispose(): void {
		this._disposed = true;
		this._onDidChangePresentation.dispose();
	}

	private async _resolve(
		target: PatentLinkTarget,
		lookup: (publicationNumber: string) => Promise<PatentPillFacts>,
		trace: (message: string) => void,
	): Promise<void> {
		let next: vscode.LinkPresentationData;
		try {
			next = buildPatentPill(await lookup(target.publicationNumber), target.source);
		} catch (error) {
			trace(`Failed to resolve ${target.publicationNumber}: ${error instanceof Error ? error.message : String(error)}`);
			next = buildUnenrichedPatentPill(target.publicationNumber);
		}
		if (this._disposed) {
			return;
		}
		this._presentation = next;
		this._onDidChangePresentation.fire();
	}
}

/** Registers the provider declared in the extension manifest. */
export function registerPatentLinkPresentationProvider(client: IPatentBackendClient, logService: ILogService): vscode.Disposable {
	return vscode.window.registerLinkPresentationProvider(
		PATENT_LINK_PRESENTATION_PROVIDER_ID,
		new PatentLinkPresentationProvider(client, logService),
	);
}
