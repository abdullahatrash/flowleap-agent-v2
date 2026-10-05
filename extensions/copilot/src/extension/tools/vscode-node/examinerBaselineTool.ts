/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { dirname, extUriBiasedIgnorePathCase, joinPath } from '../../../util/vs/base/common/resources';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { IPatentExecutionLedger } from '../../patentai/vscode-node/patentExecutionLedger';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { assertFileOkForTool } from '../node/toolUtils';
import { callFacadeTool } from './patentFacade';
import { ExaminerBaseline } from './patentFindBetter';
import { handlePatentToolError } from './patentToolError';

interface IExaminerBaselineParams {
	/** Any publication of the family with its kind, e.g. "EP2110298B1". */
	publication: string;
	/** Workspace folder the full Baseline JSON is written to. Defaults to `references`. */
	saveDir?: string;
}

/** Where the Baseline goes when the model names no folder: the folder the find-better skill reads from. */
const DEFAULT_SAVE_DIR = 'references';

/**
 * One call walks the whole family and reads about ten upstream records (a biblio per publication, a
 * grant and an enriched read per US grant), so the default request timeout is too short for it.
 */
const EXAMINER_BASELINE_TIMEOUT_MS = 180_000;

/** Gaps named in the summary; the rest are counted, and every one is in the file. */
const LISTED_GAPS = 10;

/**
 * The typed Examiner Baseline tool (ADR 0010, #526): calls the backend's `examiner_baseline` facade
 * tool through the {@link IPatentBackendClient} seam and writes the FULL result, unedited and
 * untruncated, to `<saveDir>/<publication>.examiner-baseline.json` in the workspace.
 *
 * The model gets a short summary and the file path, never the matrix: a large family cites more
 * than 1,600 documents, and a tool result with a character budget would drop rows silently (the
 * #526 defect, where `patent_api_request` cut 4 of 57 documents). The writer reads the file by
 * `baselinePath`, so no character budget applies anywhere on the way.
 */
export class ExaminerBaselineTool implements ICopilotTool<IExaminerBaselineParams> {

	public static readonly toolName = ToolName.ExaminerBaseline;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IPatentExecutionLedger private readonly ledger: IPatentExecutionLedger,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IExaminerBaselineParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Computing the Examiner Baseline of ${options.input.publication}...` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IExaminerBaselineParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const publication = options.input.publication?.trim() ?? '';
		if (!publication) {
			return new LanguageModelToolResult([new LanguageModelTextPart('Error: No publication number provided. Pass a publication of the family with its kind, e.g. EP2110298B1.')]);
		}
		const saveDir = options.input.saveDir?.trim() || DEFAULT_SAVE_DIR;
		const purpose = `Examiner Baseline of ${publication} (Find Better Step 1)`;

		// The folder is checked before the backend is called: a Baseline that cannot be saved in the
		// workspace cannot reach the writer, and returning it inline instead is the defect this tool closes.
		const target = this.targetFile(saveDir, publication);
		if (typeof target === 'string') {
			await this.ledger.record(options.chatSessionResource, { kind: 'analytics', status: 'failed', tool: 'examiner_baseline', request: publication, purpose });
			return new LanguageModelToolResult([new LanguageModelTextPart(target)]);
		}

		try {
			const baseline = await callFacadeTool<ExaminerBaseline>(this.patentBackendClient, ToolName.ExaminerBaseline, { publication }, token, { timeoutMs: EXAMINER_BASELINE_TIMEOUT_MS });
			await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, target.uri));
			await createDirectoryIfNotExists(this.fileSystemService, dirname(target.uri));
			await this.fileSystemService.writeFile(target.uri, new TextEncoder().encode(JSON.stringify(baseline, undefined, '\t') + '\n'));
			const summary = examinerBaselineSummary(baseline, publication, target.path);
			await this.ledger.record(options.chatSessionResource, {
				kind: 'analytics', status: 'succeeded', tool: 'examiner_baseline', request: publication, purpose,
				rowCount: baseline.documents?.length, resultText: summary,
			});
			this.logService.info(`[ExaminerBaselineTool] Saved the Examiner Baseline of ${publication} to ${target.path} (${baseline.documents?.length ?? 0} documents)`);
			return new LanguageModelToolResult([new LanguageModelTextPart(summary)]);
		} catch (error) {
			await this.ledger.record(options.chatSessionResource, { kind: 'analytics', status: token.isCancellationRequested ? 'cancelled' : 'failed', tool: 'examiner_baseline', request: publication, purpose });
			return handlePatentToolError(error, this.logService, '[ExaminerBaselineTool]', err => `Error computing the Examiner Baseline of ${publication}: ${err.status} - ${err.message}`);
		}
	}

	/**
	 * The file the Baseline is written to and its workspace-relative path, or why it cannot be
	 * written. Only a folder inside an open workspace folder is accepted: the writer reads
	 * `baselinePath` from the workspace only, so a file anywhere else is a file nobody can cite.
	 */
	private targetFile(saveDir: string, publication: string): { uri: URI; path: string } | string {
		const folders = this.workspaceService.getWorkspaceFolders();
		const directory = this.promptPathRepresentationService.resolveFilePath(saveDir)
			?? (folders[0] ? joinPath(folders[0], ...saveDir.replace(/\\/g, '/').split('/').filter(fragment => fragment.length > 0)) : undefined);
		const safePublication = publication.replace(/[^A-Za-z0-9.-]/g, '') || 'patent';
		const uri = directory && joinPath(directory, `${safePublication}.examiner-baseline.json`);
		const folder = uri && folders.find(candidate => extUriBiasedIgnorePathCase.isEqualOrParent(uri, candidate));
		const relative = folder && uri ? extUriBiasedIgnorePathCase.relativePath(folder, uri) : undefined;
		if (!uri || !relative || relative.startsWith('..')) {
			return `Error: saveDir "${saveDir}" is not a folder inside the open workspace. The Examiner Baseline is saved in the workspace so write_patent_results can read it as baselinePath; omit saveDir to use "${DEFAULT_SAVE_DIR}".`;
		}
		return { uri, path: relative.replace(/\\/g, '/') };
	}
}

/**
 * What the model is told about a saved Baseline: the publication, the offices, each member walked
 * with each publication's own counts, the document and gap counts, and the file path. Never the
 * matrix itself, so no character budget can cut it.
 */
function examinerBaselineSummary(baseline: ExaminerBaseline, publication: string, path: string): string {
	const documents = baseline.documents?.length ?? 0;
	const gaps = baseline.gaps ?? [];
	const members = baseline.membersWalked ?? [];
	return [
		`Examiner Baseline of ${baseline.publication ?? publication} saved in full (unedited, untruncated) to ${path}.`,
		`Offices: ${(baseline.offices ?? []).join(', ') || 'none'}.`,
		`Members walked: ${members.length}.`,
		...members.map(member => `- ${member.office ?? '?'} ${member.representativePublication ?? '?'}: ${(member.publications ?? []).map(read => `${read.publication ?? '?'} ${read.status ?? 'unknown'}${read.status === 'read' ? ` (citedCount ${read.citedCount ?? 0}, examinerCount ${read.examinerCount ?? 0})` : ''}`).join('; ') || 'no publication read'}${member.usptoEnriched ? `; USPTO enriched ${member.usptoEnriched.status ?? 'unknown'}${member.usptoEnriched.status === 'read' ? ` (${member.usptoEnriched.rows ?? 0} rows)` : ''}` : ''}`),
		`Documents: ${documents}. Gaps: ${gaps.length}.`,
		...gaps.slice(0, LISTED_GAPS).map(gap => `- Gap: ${gap.message?.trim() || `no citation record from ${gap.office ?? '?'} (${gap.member ?? '?'})`}`),
		...(gaps.length > LISTED_GAPS ? [`- …and ${gaps.length - LISTED_GAPS} more gap(s), all in the file.`] : []),
		'Provenance: every category, claim list and count was copied from the offices\' records by code, never inferred by a model. A gap means that office returned no citation record or could not be read; it is not "nothing cited".',
		`Read documents[] and the categories from ${path} with read_file. Pass "${path}" as baselinePath to write_patent_results; do not paste the matrix inline and do not edit the file.`,
	].join('\n');
}

ToolRegistry.registerTool(ExaminerBaselineTool);
