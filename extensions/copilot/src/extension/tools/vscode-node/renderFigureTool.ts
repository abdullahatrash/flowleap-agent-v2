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
import { LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import type { DrawingScene } from '../../drawings/common/scene/drawingScene';
import { BlockRequest, FlowchartRequest, renderFigureOp } from '../../drawings/node/ops/renderFigureOp';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DraftingWorkspace, textResult } from './draftingWorkspace';

interface IRenderFigureParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
	/** The figure number. */
	figure: number;
	/** The capital letter of a partial view, e.g. `A` for FIG. 1A. */
	partial?: string;
	/** The 3D scene of the Figure (ADR 0014 decision 1). */
	scene?: DrawingScene;
	flowchart?: FlowchartRequest;
	block?: BlockRequest;
	/** False returns the findings without the render; the round is recorded as not seen. */
	includeRender?: boolean;
}

const refused = 'The Figure was not rendered.';

/**
 * Renders one Figure of a drafting matter (PRD 0023, slice D5) through {@link renderFigureOp}: the
 * figure-list gate, the render, the fault list, the files and the round. This tool locates the
 * matter, decides whether the model sees the render (the request flag and the model's image
 * input), checks the Approved Claims with the drafting gate, and attaches the review render.
 */
export class RenderFigureTool implements ICopilotTool<IRenderFigureParams> {

	public static readonly toolName = ToolName.RenderFigure;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IRenderFigureParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Rendering FIG. ${options.input.figure}${options.input.partial ?? ''} of ${options.input.matter}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IRenderFigureParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const input = options.input;
		const workspace = await DraftingWorkspace.locate(input.matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const seen = input.includeRender !== false && options.model?.capabilities.supportsImageToText !== false;
		const result = await renderFigureOp(workspace.matterFiles(), { figure: input.figure, partial: input.partial, scene: input.scene, flowchart: input.flowchart, block: input.block, seen }, {
			approvedClaims: async () => {
				const approval = await workspace.requireApprovedClaims();
				return typeof approval === 'string' ? approval : { text: await workspace.read(workspace.folder.claims) ?? '' };
			},
		});
		if (!result.ok) {
			return textResult(`${refused} ${result.reason}`);
		}
		const parts: (LanguageModelTextPart | LanguageModelDataPart)[] = [new LanguageModelTextPart(result.text)];
		if (result.seen) {
			parts.push(LanguageModelDataPart.image(result.png, 'image/png'));
		}
		return new LanguageModelToolResult(parts);
	}
}

ToolRegistry.registerTool(RenderFigureTool);
