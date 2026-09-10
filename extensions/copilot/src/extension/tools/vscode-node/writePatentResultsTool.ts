/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { URI } from '../../../util/vs/base/common/uri';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IPatentExecutionLedger } from '../../patentai/vscode-node/patentExecutionLedger';
import { materializeCandidateReview, PatentCandidateReview, renderCandidateReview, validateCandidateReview } from './patentCandidateReview';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { basename, dirname, extUriBiasedIgnorePathCase } from '../../../util/vs/base/common/resources';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
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
 * Writes patent search results (or analysis) to a local file. Independent of the FlowLeap backend
 * and BYOK inference — it only touches the file system, so it works regardless of auth state.
 *
 * Reimplemented onto the platform abstractions (rather than the old fork's raw `fs`/`path`/`console`):
 * {@link IFileSystemService} for I/O (testable, cross-platform, web-capable) and {@link ILogService}
 * for tracing.
 */
export class WritePatentResultsTool implements ICopilotTool<IWritePatentResultsParams> {

	public static readonly toolName = ToolName.WritePatentResults;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IPatentExecutionLedger private readonly ledger: IPatentExecutionLedger,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
	) { }

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

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IWritePatentResultsParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
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
			const evidenceUri = uri.with({ path: uri.path + '.' + generateUuid() + '.evidence.json' });
			if (snapshot) { await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, evidenceUri)); }
			// Wrap the model's content in the chosen professional report structure, or write it
			// verbatim when no template is requested. The tool stamps what it knows (date, AI
			// authorship); the model supplies what the conversation knows; only genuinely
			// practitioner-owned fields keep the placeholder.
			const candidateContent = snapshot ? renderCandidateReview(input, snapshot, basename(evidenceUri)) : content;
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

			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Successfully wrote patent results to ${filePath}` + (evidenceDocument ? `\n${priorArtReportReceipt(uri, document, evidenceUri, evidenceDocument)}` : '\nFree-form artifact: evidence validation was not performed.'))
			]);

		} catch (error) {
			this.logService.error(`[WritePatentResultsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * A report has exactly one evidence companion: the one the receipt names. Companions left by
	 * earlier saves of the same report describe superseded validations, so they are removed once the
	 * replacement is on disk. Only this tool's own `<report>.<uuid>.evidence.json` siblings qualify,
	 * and a cleanup failure never fails a save that already succeeded.
	 */
	private async removeSupersededCompanions(report: URI, companion: URI): Promise<void> {
		const directory = dirname(report);
		const prefix = basename(report) + '.';
		const current = basename(companion);
		const companionName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.evidence\.json$/i;
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
