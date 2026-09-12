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
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { URI } from '../../../util/vs/base/common/uri';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IPatentExecutionLedger, PatentExecutionSnapshot } from '../../patentai/vscode-node/patentExecutionLedger';
import { candidateWordingReview, materializeCandidateReview, PatentCandidateReview, renderCandidateReview, validateCandidateReview } from './patentCandidateReview';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { basename, dirname, extUriBiasedIgnorePathCase } from '../../../util/vs/base/common/resources';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { ToolName } from '../common/toolNames';
import { buildSecondReadRequests, parseSecondReadVerdicts, SecondReadResult, secondReadPrompt, summarizeSecondRead } from '../common/patentSecondRead';
import { CopilotToolMode, ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { buildPatentReport, PatentReportTemplate } from '../common/patentReportTemplates';
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
 * Coverage rows judged by one second read. A report with more rows is judged only in part; the
 * diagnostic is a sample, not an audit, and a per-row model call is neither free nor instant.
 */
const SECOND_READ_ROW_LIMIT = 12;

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
			const snapshot = template === 'prior-art-report' ? await this.ledger.read(options.chatSessionResource) : undefined;
			const input = snapshot ? materializeCandidateReview(options.input, snapshot) : options.input;
			if (snapshot) {
				const errors = validateCandidateReview(input, snapshot, [content, input.objective, input.searchStrategy, ...(input.coverage ?? []).flatMap(row => [row.feature, row.gap, ...(row.evidence ?? []).flatMap(evidence => [evidence.quote, evidence.scope, evidence.qualifiers, evidence.quantityBasis])]), ...(input.limitations ?? []), input.stopReason].filter(Boolean).join('\n'));
				if (errors.length) {
					return new LanguageModelToolResult([new LanguageModelTextPart('Candidate draft was not saved. Correct these issues and retry with the revised content:\n- ' + errors.join('\n- '))]);
				}
			}
			// One id names every companion of this save: the evidence record the receipt cites, and the
			// second-read verdicts next to it.
			const companionId = generateUuid();
			const evidenceUri = uri.with({ path: uri.path + '.' + companionId + '.evidence.json' });
			if (snapshot) { await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, evidenceUri)); }
			// Wrap the model's content in the chosen professional report structure, or write it
			// verbatim when no template is requested. The tool stamps what it knows (date, AI
			// authorship); the model supplies what the conversation knows; only genuinely
			// practitioner-owned fields keep the placeholder.
			const candidateContent = snapshot ? renderCandidateReview(input, snapshot, basename(evidenceUri)) : content;
			const wording = snapshot ? candidateWordingReview(input) : [];
			const document = buildPatentReport(candidateContent, template, {
				matter: options.input.matter,
				subject: options.input.subject,
				objective: options.input.objective,
				searchStrategy: options.input.searchStrategy,
				date: new Date().toISOString().slice(0, 10),
				preparedBy: 'FlowLeap Patent AI (AI-assisted draft)',
			});


			// Ensure the parent directory exists before writing.
			await createDirectoryIfNotExists(this.fileSystemService, dirname(uri));

			const evidenceDocument = snapshot ? JSON.stringify({ schemaVersion: 1, ...snapshot }, null, 2) : undefined;
			if (evidenceDocument) {
				await this.fileSystemService.writeFile(evidenceUri, new TextEncoder().encode(evidenceDocument));
			}
			await this.fileSystemService.writeFile(uri, new TextEncoder().encode(document));
			if (evidenceDocument) {
				await this.removeSupersededCompanions(uri, evidenceUri);
			}

			this.logService.info(`[WritePatentResultsTool] Successfully wrote file: ${filePath}`);

			// Surface the deliverable by opening it in the editor. A failure to open must not fail
			// the write, so it is logged and swallowed.
			try {
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.from(uri));
			} catch (openError) {
				this.logService.warn(`[WritePatentResultsTool] Wrote file but failed to open it: ${openError instanceof Error ? openError.message : String(openError)}`);
			}

			const secondRead = snapshot ? await this.secondRead(uri, companionId, input, snapshot, token) : undefined;

			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Successfully wrote patent results to ${filePath}` + (evidenceDocument ? `${wording.length ? `\nWording review: ${wording.length} phrase(s) flagged in the report's generated section; reword them in a follow-up save if they are conclusions rather than disclaimers.` : ''}${secondRead ? `\n${secondRead}` : ''}\n${SUMMARY_CONTRACT}\n${priorArtReportReceipt(uri, document, evidenceUri, evidenceDocument)}` : '\nFree-form artifact: evidence validation was not performed.'))
			]);

		} catch (error) {
			this.logService.error(`[WritePatentResultsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Second read of the saved report: one model call per coverage row that claims disclosure, asking
	 * whether the recorded passage behind each element actually discloses it.
	 *
	 * This is a DIAGNOSTIC. It never blocks or alters the save, never enters the report, and its own
	 * failures are logged and reported as a skip. The verdicts are written next to the evidence
	 * companion so a human can adjudicate them; the tool result carries only the counts.
	 *
	 * @returns the one line to add to the tool result, or undefined when the setting is off.
	 */
	private async secondRead(report: URI, companionId: string, review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, token: CancellationToken): Promise<string | undefined> {
		if (this.configurationService.getNonExtensionConfig<string>('patent.secondRead') === 'off') { return undefined; }
		const skipped = (reason: string) => `Second read (diagnostic): skipped (${reason}).`;
		try {
			const request = this._inputContext?.request;
			if (!request) { return skipped('no chat request context'); }
			const requests = buildSecondReadRequests(review, snapshot);
			if (!requests.length) { return skipped('no supported or partial row lists elements'); }
			const endpoint = await this.endpointProvider.getChatEndpoint(request);
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
				if (response.type !== ChatFetchResponseType.Success) { return skipped(`judge request ${response.type}`); }
				const verdicts = parseSecondReadVerdicts(response.value);
				results.push({ feature: secondReadRequest.feature, status: secondReadRequest.status, ...(verdicts ? { verdicts } : { unparsed: response.value }) });
			}
			const summary = summarizeSecondRead(results);
			const verdictUri = report.with({ path: report.path + '.' + companionId + '.second-read.json' });
			await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, verdictUri));
			await this.fileSystemService.writeFile(verdictUri, new TextEncoder().encode(JSON.stringify({ model: endpoint.model, judgedAt: new Date().toISOString(), rows: results, summary }, null, 2)));
			return `Second read (diagnostic): ${summary.elements} elements judged, ${summary.disagree} disagree, ${summary.unclear} unclear, ${summary.unparsed} unparsed; verdicts in ${basename(verdictUri)}.`;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[WritePatentResultsTool] Second read did not complete: ${message}`);
			return skipped(message);
		}
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
