/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { officeAction } from '../common/drafting/checklist';
import { parseClaims } from '../common/drafting/claims';
import { claimTermsToPlan } from '../common/drafting/claimValidators';
import { DRAFT_OUTLINE_SAVE } from '../common/drafting/folderContract';
import { parseDraftingFrontmatter, readOffice } from '../common/drafting/frontmatter';
import { STYLE_INSTRUCTION } from '../common/drafting/styleFolder';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DraftingWorkspace, textResult } from './draftingWorkspace';
import { readPdfText } from './pdfPreviewApi';

interface IStartApplicationDraftParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
}

const refused = 'Drafting did not start.';

/**
 * Starts an Application Drafting run (ADR 0012): reads the `confirmed` gate of `feature-list.md`
 * and the `approved` gate of `claims.md` from the files, never from the chat, and returns the
 * Feature List, the figures, the Approved Claims, the claim terms to plan (the exact terms the
 * outline-coverage rule checks), the Draft Outline when it was made for the Approved Claims
 * (PRD 0022), and up to five style exemplars as text. It
 * records the hash of the approved claims in the Working Record; when `claims.md` changes later,
 * the drafting tools clear `approved` and refuse until the attorney approves again.
 */
export class StartApplicationDraftTool implements ICopilotTool<IStartApplicationDraftParams> {

	public static readonly toolName = ToolName.StartApplicationDraft;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	/**
	 * Reads a PDF style exemplar through the FlowLeap PDF Preview extension. A seam for tests, which
	 * override it; a constructor parameter would conflict with the tool registry's argument-free
	 * instantiation.
	 */
	protected readPdf(uri: URI): Promise<string> {
		return readPdfText(uri);
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IStartApplicationDraftParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Reading the drafting inputs of ${options.input.matter}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IStartApplicationDraftParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const workspace = await DraftingWorkspace.locate(options.input.matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const { folder } = workspace;
		const featureList = await workspace.requireConfirmedFeatureList();
		if (typeof featureList === 'string') {
			return workspace.refusal(refused, featureList);
		}
		const approval = await workspace.requireApprovedClaims();
		if (typeof approval === 'string') {
			return workspace.refusal(refused, approval);
		}
		const office = readOffice(featureList.fields);
		if (!office) {
			return workspace.refusal(refused, `${folder.featureList} names no office. ${officeAction(folder.featureList)}`);
		}
		await workspace.recordApprovedClaims(approval.hash);
		const figures = await workspace.read(folder.figures);
		const claims = await workspace.read(folder.claims) ?? '';
		const exemplars = await workspace.styleExemplars(uri => this.readPdf(uri));
		const outline = await workspace.readOutline(approval.hash);
		const body = (text: string) => parseDraftingFrontmatter(text).body.trim();
		const saveOutline = `save it ${DRAFT_OUTLINE_SAVE}, to ${folder.draftOutline}`;
		const outlineSection = !outline
			? `No ${folder.draftOutline} yet. Plan first: write the Draft Outline for the Approved Claims and ${saveOutline}. The draft save refuses without it.`
			: outline.stale
				? `The Draft Outline is stale: ${outline.stale} Plan from the Approved Claims above and ${saveOutline} before drafting; the draft save refuses until then.`
				: body(outline.text);

		const sections = [
			`Drafting started for matter "${folder.matter}". Office: ${office}. Gates read from the files: \`confirmed: true\` in ${folder.featureList}, \`approved: true\` in ${folder.claims}. The approved claims are recorded (SHA-256 ${approval.hash}) in ${folder.workingRecord}: when ${folder.claims} changes, the drafting tools set \`approved\` to \`false\` and refuse until the attorney approves again.`,
			`Save the Draft Outline ${DRAFT_OUTLINE_SAVE}, to ${folder.draftOutline}; then save the draft with template draft-application, to ${folder.draft}; then call validate_draft. ${await workspace.checklistLine(false)}`,
			'',
			`## Feature List (${folder.featureList})`,
			'',
			body(featureList.text),
			'',
			`## Figures (${folder.figures})`,
			'',
			figures === undefined ? 'No figures.md: the application has no figures unless the attorney supplies them.' : body(figures),
			'',
			`## Approved Claims (${folder.claims})`,
			'',
			body(claims),
			'',
			'## Claim terms to plan',
			'',
			'Copy these terms verbatim into the `Claim terms` column of the Draft Outline; the outline-coverage rule checks these exact terms.',
			'',
			...claimTermLines(claims),
			'',
			`## Draft Outline (${folder.draftOutline})`,
			'',
			outlineSection,
			'',
			'## Style exemplars (style only, never a source)',
			'',
			exemplars.length
				? 'Voice and structure only. No fact, feature, embodiment, value, example or result enters the draft from an exemplar.'
				: `No exemplar in style/: use the office template style only. Tell the attorney: ${STYLE_INSTRUCTION}`,
			...exemplars.flatMap((exemplar, index) => [
				'',
				`### Style exemplar ${index + 1}: ${exemplar.path} (style only, never a source)`,
				'',
				exemplar.error ? `Not read: ${exemplar.error}.` : `${exemplar.text?.trim()}${exemplar.truncated ? '\n\n[Exemplar cut here; the rest is not shown.]' : ''}`,
			]),
		];
		return textResult(sections.join('\n'));
	}
}

/**
 * One line per Approved Claim with the terms it introduces, `Claim 1: a; b`; a dependent claim
 * names its independent claims, `Claim 3 (with claim 1): c`.
 */
function claimTermLines(claims: string): string[] {
	return claimTermsToPlan(parseClaims(claims)).map(({ claim, independentClaims, terms }) => {
		const roots = independentClaims.length ? ` (with claim${independentClaims.length > 1 ? 's' : ''} ${independentClaims.join(', ')})` : '';
		return `Claim ${claim}${roots}: ${terms.length ? terms.join('; ') : 'no new claim term'}`;
	});
}

ToolRegistry.registerTool(StartApplicationDraftTool);
