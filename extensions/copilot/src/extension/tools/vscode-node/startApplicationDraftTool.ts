/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { parseDraftingFrontmatter, readGateFlag, readOffice } from '../common/drafting/frontmatter';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DraftingWorkspace, gateRefusal, PdfTextReader } from './draftingWorkspace';
import { readPdfText } from './pdfPreviewApi';

interface IStartApplicationDraftParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
}

function refusal(reason: string): LanguageModelToolResult {
	return new LanguageModelToolResult([new LanguageModelTextPart(`Drafting did not start. ${reason}`)]);
}

/**
 * Starts an Application Drafting run (ADR 0012): reads the `confirmed` gate of `feature-list.md`
 * and the `approved` gate of `claims.md` from the files, never from the chat, and returns the
 * Feature List, the figures, the Approved Claims and up to five style exemplars as text. It
 * records the hash of the approved claims in the Working Record; when `claims.md` changes later,
 * the drafting tools clear `approved` and refuse until the attorney approves again.
 */
export class StartApplicationDraftTool implements ICopilotTool<IStartApplicationDraftParams> {

	public static readonly toolName = ToolName.StartApplicationDraft;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		private readonly readPdf: PdfTextReader = uri => readPdfText(uri),
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IStartApplicationDraftParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Reading the drafting inputs of ${options.input.matter}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IStartApplicationDraftParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const workspace = await DraftingWorkspace.locate(options.input.matter ?? '', this.workspaceService.getWorkspaceFolders(), this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return refusal(workspace);
		}
		const { folder } = workspace;
		const featureList = await workspace.read(folder.featureList);
		const featureFields = featureList === undefined ? undefined : parseDraftingFrontmatter(featureList).fields;
		const confirmed = featureFields ? readGateFlag(featureFields, 'confirmed') : 'no-file';
		if (confirmed !== 'set') {
			return refusal(gateRefusal(folder.featureList, 'confirmed', confirmed));
		}
		const approval = await workspace.checkClaimsApproval();
		if (approval.changed && approval.cleared) {
			return refusal(approval.changed);
		}
		if (approval.gate !== 'set' || !approval.hash) {
			return refusal(gateRefusal(folder.claims, 'approved', approval.gate));
		}
		const office = readOffice(featureFields ?? {});
		if (!office) {
			return refusal(`${folder.featureList} names no office. Its frontmatter needs \`office: US\` or \`office: EPO\`.`);
		}
		await workspace.recordApprovedClaims(approval.hash);
		const figures = await workspace.read(folder.figures);
		const claims = await workspace.read(folder.claims) ?? '';
		const exemplars = await workspace.styleExemplars(this.readPdf);
		const body = (text: string) => parseDraftingFrontmatter(text).body.trim();

		const sections = [
			`Drafting started for matter "${folder.matter}". Office: ${office}. Gates read from the files: \`confirmed: true\` in ${folder.featureList}, \`approved: true\` in ${folder.claims}. The approved claims are recorded (SHA-256 ${approval.hash}) in ${folder.workingRecord}: when ${folder.claims} changes, the drafting tools set \`approved\` to \`false\` and refuse until the attorney approves again.`,
			`Save the draft with write_patent_results, template draft-application, to ${folder.draft}; then call validate_draft.`,
			'',
			`## Feature List (${folder.featureList})`,
			'',
			body(featureList ?? ''),
			'',
			`## Figures (${folder.figures})`,
			'',
			figures === undefined ? 'No figures.md: the application has no figures unless the attorney supplies them.' : body(figures),
			'',
			`## Approved Claims (${folder.claims})`,
			'',
			body(claims),
			'',
			'## Style exemplars (style only, never a source)',
			'',
			exemplars.length
				? 'Voice and structure only. No fact, feature, embodiment, value, example or result enters the draft from an exemplar.'
				: 'No exemplar in style/: use the office template only.',
			...exemplars.flatMap((exemplar, index) => [
				'',
				`### Style exemplar ${index + 1}: ${exemplar.path} (style only, never a source)`,
				'',
				exemplar.error ? `Not read: ${exemplar.error}.` : `${exemplar.text?.trim()}${exemplar.truncated ? '\n\n[Exemplar cut here; the rest is not shown.]' : ''}`,
			]),
		];
		return new LanguageModelToolResult([new LanguageModelTextPart(sections.join('\n'))]);
	}
}

ToolRegistry.registerTool(StartApplicationDraftTool);
