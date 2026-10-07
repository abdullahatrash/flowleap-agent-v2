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
import { DraftFinding } from '../common/drafting/finding';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DraftingWorkspace, findingsSummary } from './draftingWorkspace';

/** One item of the model's advisory review. */
interface IAdvisoryItem {
	/** The item, quoting the passage it concerns. */
	message: string;
	/** The 1-based line of the passage in draft-application.md. */
	line?: number;
	/** The claim the item concerns. */
	claim?: number;
}

interface IValidateDraftParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
	/** The advisory review items; they never block export. */
	advisory?: IAdvisoryItem[];
}

function result(text: string): LanguageModelToolResult {
	return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
}

/**
 * Runs the deterministic validators of the office over a Draft Application (ADR 0012 decision 4),
 * adds the advisory items the model passes in as Advisory findings, and writes `findings.md`,
 * keeping the attorney's waivers. When `claims.md` changed after approval it adds a
 * `claims-changed` Error (and clears `approved`). It never says the draft passed.
 */
export class ValidateDraftTool implements ICopilotTool<IValidateDraftParams> {

	public static readonly toolName = ToolName.ValidateDraft;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IValidateDraftParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Validating the draft of ${options.input.matter}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IValidateDraftParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const workspace = await DraftingWorkspace.locate(options.input.matter ?? '', this.workspaceService.getWorkspaceFolders(), this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return result(`The draft was not validated. ${workspace}`);
		}
		const { folder } = workspace;
		const draft = await workspace.read(folder.draft);
		if (draft === undefined) {
			return result(`The draft was not validated. ${folder.draft} does not exist: save the draft with write_patent_results, template draft-application, first.`);
		}
		const claims = await workspace.read(folder.claims);
		if (claims === undefined) {
			return result(`The draft was not validated. ${folder.claims} does not exist.`);
		}
		const office = await workspace.office(draft);
		if (!office) {
			return result(`The draft was not validated. Neither ${folder.draft} nor ${folder.featureList} names the office (\`office: US\` or \`office: EPO\`).`);
		}
		const approval = await workspace.checkClaimsApproval();
		const advisory: DraftFinding[] = (options.input.advisory ?? []).filter(item => item.message?.trim()).map(item => ({
			severity: 'Advisory',
			rule: 'advisory',
			message: item.message.trim(),
			file: 'draft-application.md',
			...(item.line !== undefined ? { line: item.line } : {}),
			...(item.claim !== undefined ? { claim: item.claim } : {}),
		}));
		const findings = await workspace.validate(office, draft, await workspace.read(folder.claims) ?? claims, approval, advisory);
		return result(`Wrote ${folder.findings} (${office} validators${advisory.length ? `, ${advisory.length} advisory item(s)` : ''}; waivers kept).\n${findingsSummary(findings)}\nReport these by severity with their line references. Do not call the draft passed or ready to file.`);
	}
}

ToolRegistry.registerTool(ValidateDraftTool);
