/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Raw } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { toTextParts } from '../../../platform/chat/common/globalStringUtils';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { URI } from '../../../util/vs/base/common/uri';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IActivationTelemetryService } from '../../patentai/vscode-node/activationTelemetryService';
import { FREE_FORM_TEMPLATE_KIND } from '../../patentai/common/activationTelemetry';
import { IPatentExecutionLedger, PatentExecutionSnapshot } from '../../patentai/vscode-node/patentExecutionLedger';
import { CandidateReviewVariant, candidateWordingReview, challengedClaims, materializeCandidateReview, PatentCandidateReview, renderCandidateReview, renderWorkingRecord, validateCandidateReview } from './patentCandidateReview';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { basename, dirname, extUriBiasedIgnorePathCase } from '../../../util/vs/base/common/resources';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatRequest, LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { ToolName } from '../common/toolNames';
import { buildSecondReadRequests, parseSecondReadVerdicts, SecondReadOutcome, SecondReadResult, secondReadPrompt, summarizeSecondRead, unconfirmedVerdicts } from '../common/patentSecondRead';
import { CopilotToolMode, ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { buildPatentReport, contentRequirementError, PatentReportTemplate } from '../common/patentReportTemplates';
import { extractFigures, figureProvenance, figureSentence, ftoProvenanceResult, renderFtoAppendix, renderLandscapeAppendix } from '../common/patentReportProvenance';
import { priorArtReportReceipt } from '../node/priorArtReportCompletion';
import { assertFileOkForTool } from '../node/toolUtils';

interface IWritePatentResultsParams extends PatentCandidateReview {
	filePath: string;
	content: string;
	/** Optional report template. Omitted = free-form save of `content` unchanged. */
	template?: PatentReportTemplate;
	/** Matter/case reference or the document's identifying number, when the user provided one. */
	matter?: string;
	/** The technology/product/portfolio the report is about, in a short phrase. */
	subject?: string;
	/** One or two sentences: the question the work answers (prior-art-report). */
	objective?: string;
	/** Short summary of databases, codes, and key queries used (prior-art and landscape reports). */
	searchStrategy?: string;
}

/**
 * How much of the second read the user sees. `off` disables it; `log` and `render` both record the
 * verdicts in a file beside the evidence companion and state them in the working record, and
 * `render` additionally names in the tool result what an independent read did not confirm, so the
 * model has to decide whether to revise a row or defend it.
 */
type SecondReadMode = 'off' | 'log' | 'render';

/**
 * The working record beside a report: a stable name, with no companion id, because a later session
 * on the same matter looks for it by name and a refinement save must replace it rather than leave a
 * second copy. It is not a `<report>.<uuid>.…` companion, so the superseded-companion sweep never
 * matches it.
 */
function workingRecordPath(reportPath: string): string {
	return reportPath.replace(/\.md$/i, '') + '.working-record.md';
}

/**
 * Coverage rows judged by one second read. A report with more rows is judged only in part; the
 * diagnostic is a sample, not an audit, and a per-row model call is neither free nor instant.
 */
const SECOND_READ_ROW_LIMIT = 12;

/** Unconfirmed elements named in the tool result; the rest are counted and left to the report. */
const SECOND_READ_RESULT_LIMIT = 6;

/**
 * The saved report is the record; the chat summary that follows it must not become more certain than
 * that record, so the save states the contract the summary has to keep.
 */
const SUMMARY_CONTRACT = 'Chat summary contract: repeat each coverage row\'s status word exactly (supported / partial / unresolved), do not add novelty, anticipation, obviousness or teaching-away conclusions, and state the retrieved-but-not-cited count and any untranslated documents. The summary must not be more certain than the saved report.';

/**
 * Writes patent search results (or analysis) to a local file. Independent of the FlowLeap backend
 * and BYOK inference — it only touches the file system, so it works regardless of auth state.
 *
 * Reimplemented onto the platform abstractions (rather than the old fork's raw `fs`/`path`/`console`):
 * {@link IFileSystemService} for I/O (testable, cross-platform, web-capable) and {@link ILogService}
 * for tracing.
 */
export class WritePatentResultsTool implements ICopilotTool<IWritePatentResultsParams> {

	public static readonly toolName = ToolName.WritePatentResults;

	/** The request the save was made under; the second read needs it to resolve the user's model. */
	private _inputContext: IBuildPromptContext | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IPatentExecutionLedger private readonly ledger: IPatentExecutionLedger,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@IActivationTelemetryService private readonly activationTelemetryService: IActivationTelemetryService,
	) { }

	async resolveInput(input: IWritePatentResultsParams, promptContext: IBuildPromptContext, _mode: CopilotToolMode): Promise<IWritePatentResultsParams> {
		this._inputContext = promptContext;
		return input;
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IWritePatentResultsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { filePath } = options.input;
		return {
			invocationMessage: l10n.t`Writing patent results to ${filePath}`,
			confirmationMessages: {
				title: l10n.t`Write Patent Results`,
				message: l10n.t`Allow Patent AI to write search results to ${filePath}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IWritePatentResultsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[WritePatentResultsTool] Invoking write patent results');

		const { filePath, content, template } = options.input;

		// prior-art-report always generates its body from structured coverage; invalidity-claim-chart
		// does so when the model supplies coverage, and keeps the written-content chart when it does not.
		const structuredBody = template === 'prior-art-report' || (template === 'invalidity-claim-chart' && !!options.input.coverage?.length);
		const variant: CandidateReviewVariant = template === 'invalidity-claim-chart' ? 'invalidity' : 'prior-art';

		// A templated report with no body saves a shell of section stubs while the findings stay in
		// the chat, so the requirement is checked before any path resolution or disk access.
		const requirement = contentRequirementError(template, content, structuredBody);
		if (requirement) {
			return new LanguageModelToolResult([new LanguageModelTextPart(`Report was not saved. ${requirement} Retry with the report body in content.`)]);
		}

		// Resolve relative paths against the workspace (and reject invalid input) rather than
		// mapping them to the filesystem root via `URI.file`.
		const folders = this.workspaceService.getWorkspaceFolders();
		const relative = filePath.trim().length > 0 && !/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(filePath) && !filePath.includes('\0');
		const uri = this.promptPathRepresentationService.resolveFilePath(filePath) ?? (relative && folders.length === 1 ? URI.joinPath(folders[0], filePath.replace(/\\/g, '/')) : undefined);
		if (!uri) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: Invalid file path "${filePath}". Provide an absolute workspace path, or a relative path when exactly one workspace folder is open.`)
			]);
		}

		if (!folders.some(folder => extUriBiasedIgnorePathCase.isEqualOrParent(uri, folder))) {
			return new LanguageModelToolResult([new LanguageModelTextPart('Error: Patent result writes must stay within a workspace folder.')]);
		}

		// Confine writes to the workspace before touching disk. Throws a clear "outside of the
		// workspace" error for out-of-workspace paths, which propagates as the tool error.
		await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, uri));

		try {
			const snapshot = structuredBody ? await this.ledger.read(options.chatSessionResource) : undefined;
			const input = snapshot ? materializeCandidateReview(options.input, snapshot) : options.input;
			if (snapshot) {
				const errors = validateCandidateReview(input, snapshot, [content, input.objective, input.searchStrategy, ...(input.concepts ?? []).flatMap(entry => [entry.concept, ...entry.synonyms]), ...(input.classifications ?? []).flatMap(entry => [entry.code, entry.meaning]), ...(input.coverage ?? []).flatMap(row => [row.feature, row.gap, ...(row.evidence ?? []).flatMap(evidence => [evidence.quote, evidence.scope, evidence.qualifiers, evidence.quantityBasis])]), ...(input.limitations ?? []), input.stopReason].filter(Boolean).join('\n'), variant);
				if (errors.length) {
					return new LanguageModelToolResult([new LanguageModelTextPart('Candidate draft was not saved. Correct these issues and retry with the revised content:\n- ' + errors.join('\n- '))]);
				}
			}
			// One id names every companion of this save: the evidence record the receipt cites, and the
			// second-read verdicts next to it.
			const companionId = generateUuid();
			const evidenceUri = uri.with({ path: uri.path + '.' + companionId + '.evidence.json' });
			const recordUri = uri.with({ path: workingRecordPath(uri.path) });
			if (snapshot) {
				await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, evidenceUri));
			}
			// The report is written once, with the second read already in it, so the receipt covers the
			// final bytes. A judge failure is caught below and never reaches the save.
			const mode = this.secondReadMode();
			const secondRead = snapshot && mode !== 'off' ? await this.secondRead(input, snapshot, token) : undefined;
			// Wrap the model's content in the chosen professional report structure, or write it
			// verbatim when no template is requested. The tool stamps what it knows (date, AI
			// authorship); the model supplies what the conversation knows; only genuinely
			// practitioner-owned fields keep the placeholder.
			const candidateContent = snapshot ? renderCandidateReview(input, snapshot, basename(recordUri), variant) : content;
			const wording = snapshot ? candidateWordingReview(input) : [];
			// A landscape report is a page of numbers; every other content template (FTO memo, invalidity
			// chart, infringement chart, office-action scaffold, opinion, due-diligence memo) is a page of
			// statuses, dates and quoted claims. The generated sections state which of them appear in the
			// text a tool returned, which tables never say what they count, and which quotations stand in
			// the recorded claim text of the document they are cited to.
			const provenance = template && !structuredBody ? await this.ledger.read(options.chatSessionResource) : undefined;
			const appendix = !provenance ? undefined : template === 'landscape-report' ? renderLandscapeAppendix(content, provenance) : renderFtoAppendix(content, provenance);
			// The structured chart's header fields are read off the rows themselves, so the claims it
			// states are the claims it actually charts.
			const invalidityFields = structuredBody && variant === 'invalidity' ? {
				challengedPublication: input.challengedPublication ?? options.input.matter,
				claimsAtIssue: challengedClaims(input).join(', '),
				criticalDateBasis: options.input.objective,
			} : {};
			const document = buildPatentReport(candidateContent, template, {
				matter: options.input.matter,
				subject: options.input.subject,
				objective: options.input.objective,
				searchStrategy: options.input.searchStrategy,
				date: new Date().toISOString().slice(0, 10),
				preparedBy: 'FlowLeap Patent AI (AI-assisted draft)',
				...invalidityFields,
			}, appendix, structuredBody);


			// Ensure the parent directory exists before writing.
			await createDirectoryIfNotExists(this.fileSystemService, dirname(uri));

			const evidenceDocument = snapshot ? JSON.stringify({ schemaVersion: 1, ...snapshot }, null, 2) : undefined;
			if (evidenceDocument) {
				await this.fileSystemService.writeFile(evidenceUri, new TextEncoder().encode(evidenceDocument));
			}
			await this.fileSystemService.writeFile(uri, new TextEncoder().encode(document));
			// A deliverable reached disk. The template kind is the whole counter — never the path,
			// the matter, the subject, or a byte of the report. Fire-and-forget by contract: it
			// cannot throw, and it never changes what the tool returns.
			this.activationTelemetryService.recordReportSaved(template ?? FREE_FORM_TEMPLATE_KIND);
			if (evidenceDocument) {
				await this.removeSupersededCompanions(uri, evidenceUri);
			}
			const verdictFileName = secondRead ? await this.writeSecondReadFile(uri, companionId, secondRead) : undefined;
			// The record links the verdict file, so it is written after it; losing it must not cost the
			// report that is already on disk, so a failure is a warning and an unnamed record.
			const recordWritten = snapshot ? await this.writeWorkingRecord(recordUri, renderWorkingRecord(input, snapshot, basename(uri), basename(evidenceUri), verdictFileName, secondRead)) : false;

			this.logService.info(`[WritePatentResultsTool] Successfully wrote file: ${filePath}`);

			// Surface the deliverable by opening it in the editor. A failure to open must not fail
			// the write, so it is logged and swallowed.
			try {
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.from(uri));
			} catch (openError) {
				this.logService.warn(`[WritePatentResultsTool] Wrote file but failed to open it: ${openError instanceof Error ? openError.message : String(openError)}`);
			}

			// A save that carries a generated provenance appendix is a checked report, not a free-form
			// artifact, so it states what was traced instead of that nothing was.
			const provenanceResult = !provenance ? '' : template === 'landscape-report' ? this.landscapeResult(content, provenance) : ftoProvenanceResult(content, provenance);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Successfully wrote patent results to ${filePath}` + provenanceResult + (evidenceDocument ? `${wording.length ? `\nWording review: ${wording.length} phrase(s) flagged in the working record; reword them in a follow-up save if they are conclusions rather than disclaimers.` : ''}${this.secondReadResult(mode, secondRead, verdictFileName)}\n${SUMMARY_CONTRACT}\n${priorArtReportReceipt(uri, document, evidenceUri, evidenceDocument)}${recordWritten ? `\nWorking record: ${workingRecordPath(filePath)}` : ''}` : provenance ? '' : '\nFree-form artifact: evidence validation was not performed.'))
			]);

		} catch (error) {
			this.logService.error(`[WritePatentResultsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * What the model is told about the figures it just saved. The report states the same thing; the
	 * tool result is what lets the model correct an untraceable figure in a follow-up save.
	 */
	private landscapeResult(content: string, snapshot: PatentExecutionSnapshot): string {
		const provenance = figureProvenance(extractFigures(content), snapshot, content);
		return `\nFigure provenance: ${figureSentence(provenance)}`
			+ (provenance.unmatched.length ? ' Give each figure that was not found its counting basis and source in a follow-up save, or replace it with a figure a recorded output supports.' : '')
			+ ' The report lists them in its generated provenance appendix.';
	}

	/** How much of the second read reaches the user: nothing, a file, or the report itself. */
	private secondReadMode(): SecondReadMode {
		const configured = this.configurationService.getNonExtensionConfig<string>('patent.secondRead');
		return configured === 'off' || configured === 'log' || configured === 'render' ? configured : 'render';
	}

	/**
	 * The endpoint that judges the report. The configured model is preferred, but the provider
	 * answers a family it cannot match with an arbitrary BYO-key model rather than an error, so the
	 * resolved endpoint is checked against what was asked for and the request's own model is used
	 * when it does not match. The model actually used is the one recorded and rendered.
	 */
	private async judgeEndpoint(request: ChatRequest): Promise<IChatEndpoint> {
		const configured = this.configurationService.getNonExtensionConfig<string>('patent.secondRead.model')?.trim();
		if (configured) {
			try {
				const endpoint = await this.endpointProvider.getChatEndpoint(configured);
				if (endpoint && (endpoint.model === configured || endpoint.family === configured)) { return endpoint; }
				this.logService.warn(`[WritePatentResultsTool] Second-read model '${configured}' is unavailable; judging with the request's model.`);
			} catch (error) {
				this.logService.warn(`[WritePatentResultsTool] Second-read model '${configured}' could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return this.endpointProvider.getChatEndpoint(request);
	}

	/**
	 * Second read of the report being saved: one model call per coverage row that claims disclosure,
	 * asking whether the recorded passage behind each element actually discloses it.
	 *
	 * It never blocks the save and never changes a status. Every failure — no endpoint, a refused
	 * request, a cancellation — is caught, logged, and returned as a skip the report and the tool
	 * result both state.
	 */
	private async secondRead(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, token: CancellationToken): Promise<SecondReadOutcome> {
		try {
			const request = this._inputContext?.request;
			if (!request) { return { kind: 'skipped', reason: 'no chat request context' }; }
			const requests = buildSecondReadRequests(review, snapshot);
			if (!requests.length) { return { kind: 'skipped', reason: 'no supported or partial row lists elements' }; }
			const endpoint = await this.judgeEndpoint(request);
			const results: SecondReadResult[] = [];
			for (const secondReadRequest of requests.slice(0, SECOND_READ_ROW_LIMIT)) {
				const response = await endpoint.makeChatRequest2({
					debugName: 'patentSecondRead',
					messages: [{ role: Raw.ChatRole.User, content: toTextParts(secondReadPrompt(secondReadRequest)) }],
					finishedCb: undefined,
					location: ChatLocation.Other,
					userInitiatedRequest: false,
					isConversationRequest: false,
					requestOptions: { temperature: 0 },
				}, token);
				if (response.type !== ChatFetchResponseType.Success) { return { kind: 'skipped', reason: `judge request ${response.type}` }; }
				const verdicts = parseSecondReadVerdicts(response.value);
				results.push({ feature: secondReadRequest.feature, status: secondReadRequest.status, ...(verdicts ? { verdicts } : { unparsed: response.value }) });
			}
			return { kind: 'judged', model: endpoint.model, rows: results, summary: summarizeSecondRead(results) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[WritePatentResultsTool] Second read did not complete: ${message}`);
			return { kind: 'skipped', reason: message };
		}
	}

	/**
	 * Record the verdicts beside the evidence companion, under the same id. The record is what a
	 * human adjudicates later, so losing it must not cost the save that already succeeded.
	 */
	private async writeSecondReadFile(report: URI, companionId: string, outcome: SecondReadOutcome): Promise<string | undefined> {
		if (outcome.kind !== 'judged') { return undefined; }
		const verdictUri = report.with({ path: report.path + '.' + companionId + '.second-read.json' });
		try {
			await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, verdictUri));
			await this.fileSystemService.writeFile(verdictUri, new TextEncoder().encode(JSON.stringify({ model: outcome.model, judgedAt: new Date().toISOString(), rows: outcome.rows, summary: outcome.summary }, null, 2)));
			return basename(verdictUri);
		} catch (error) {
			this.logService.warn(`[WritePatentResultsTool] Second-read verdicts were not written: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}

	/**
	 * Write the working record beside the report, under its stable name, so a refinement save
	 * replaces the record of the run it refines. The eligibility check runs here, not beside the
	 * report's own, so an ineligible record path is a warning and an unnamed record, never a reason to
	 * abort a save whose deliverable is already on disk.
	 */
	private async writeWorkingRecord(record: URI, document: string): Promise<boolean> {
		try {
			await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, record));
			await this.fileSystemService.writeFile(record, new TextEncoder().encode(document));
			return true;
		} catch (error) {
			this.logService.warn(`[WritePatentResultsTool] Working record was not written: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}
	}

	/**
	 * What the model is told about the second read. `log` reports counts and the file; `render`
	 * names what was not confirmed, so the model has to decide whether to revise a row or defend it.
	 * Either way the verdicts themselves are stated in the working record, never in the report.
	 */
	private secondReadResult(mode: SecondReadMode, outcome: SecondReadOutcome | undefined, verdictFileName: string | undefined): string {
		if (!outcome) { return ''; }
		if (outcome.kind === 'skipped') { return `\nSecond read (diagnostic): skipped (${outcome.reason}).`; }
		const { elements, disagree, unclear, unparsed } = outcome.summary;
		if (mode === 'log') {
			return `\nSecond read (diagnostic): ${elements} elements judged, ${disagree} disagree, ${unclear} unclear, ${unparsed} unparsed; verdicts in ${verdictFileName ?? 'no file (write failed)'}.`;
		}
		const unconfirmed = unconfirmedVerdicts(outcome.rows);
		const shown = unconfirmed.slice(0, SECOND_READ_RESULT_LIMIT);
		// Each reason is its own sentence; the list punctuates itself, so a trailing stop is dropped.
		const listed = shown.map(item => `${item.feature} / ${item.element} — ${item.reason.trim().replace(/\.$/, '')}`).join('; ')
			+ (unconfirmed.length > shown.length ? `; and ${unconfirmed.length - shown.length} more in the working record` : '');
		return `\nSecond read (${outcome.model}): ${elements} elements judged, ${disagree} not confirmed${unclear ? `, ${unclear} unclear` : ''}.`
			+ (unconfirmed.length ? ` Not confirmed: ${listed}.\nIf a disagreement is right, downgrade or reword that row and re-save; if the second read is wrong, leave the row and say why in its gap.` : '');
	}

	/**
	 * A report has exactly one evidence companion: the one the receipt names. Companions left by
	 * earlier saves of the same report describe superseded validations, so they are removed once the
	 * replacement is on disk. Only this tool's own `<report>.<uuid>.evidence.json` siblings and the
	 * `<report>.<uuid>.second-read.json` diagnostics beside them qualify, and a cleanup failure never
	 * fails a save that already succeeded. The current save's second read is written afterwards, so
	 * its own file cannot be swept here.
	 */
	private async removeSupersededCompanions(report: URI, companion: URI): Promise<void> {
		const directory = dirname(report);
		const prefix = basename(report) + '.';
		const current = basename(companion);
		const companionName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:evidence|second-read)\.json$/i;
		try {
			for (const [name] of await this.fileSystemService.readDirectory(directory)) {
				if (name === current || !name.startsWith(prefix) || !companionName.test(name.slice(prefix.length))) { continue; }
				await this.fileSystemService.delete(URI.joinPath(directory, name));
			}
		} catch (error) {
			this.logService.warn(`[WritePatentResultsTool] Kept superseded evidence companions: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

ToolRegistry.registerTool(WritePatentResultsTool);
