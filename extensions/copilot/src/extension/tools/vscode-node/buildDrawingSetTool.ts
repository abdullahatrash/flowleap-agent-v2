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
import { buildDrawingSetOp } from '../../drawings/node/ops/buildDrawingSetOp';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DraftingWorkspace, textResult } from './draftingWorkspace';

interface IBuildDrawingSetParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
	/** Build for review although Figures of figures.md are not drawn; never a filable set. */
	partial?: boolean;
}

const refused = 'The Drawing Set was not built.';

/**
 * Builds the Drawing Set of a drafting matter (PRD 0023, slice D5) through
 * {@link buildDrawingSetOp}: the gates, the sheets, the PDF, the receipt and the manifest count.
 * It never says the set complies.
 */
export class BuildDrawingSetTool implements ICopilotTool<IBuildDrawingSetParams> {

	public static readonly toolName = ToolName.BuildDrawingSet;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildDrawingSetParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Building the Drawing Set of ${options.input.matter}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IBuildDrawingSetParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const workspace = await DraftingWorkspace.locate(options.input.matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const result = await buildDrawingSetOp(workspace.matterFiles(), { partial: options.input.partial === true });
		return textResult(result.ok ? result.text : `${refused} ${result.reason}`);
	}
}

ToolRegistry.registerTool(BuildDrawingSetTool);
