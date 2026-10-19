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
import { figureId } from '../../drawings/common/drawingFiles';
import { BlockRequest, FlowchartRequest, readReviewState, renderFigureOp } from '../../drawings/node/ops/renderFigureOp';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { attachedImages, copyAttachedSketches } from './attachedSketches';
import { DraftingEditors, DraftingWorkspace, textResult, vscodeEditors } from './draftingWorkspace';

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
	/** Starts the next review cycle (three more rounds); the attorney confirms it in chat first (#696). */
	newCycle?: boolean;
}

const refused = 'The Figure was not rendered.';

/**
 * Renders one Figure of a drafting matter (PRD 0023, slice D5) through {@link renderFigureOp}: the
 * figure-list gate, the render, the fault list, the files and the round. This tool locates the
 * matter, decides whether the model sees the render (the request flag and the model's image
 * input), checks the Approved Claims with the drafting gate, and attaches the review render. It
 * copies every image attached to the turn to `sketches/` (read in `resolveInput`), so a sketch
 * used for a render stays with the matter (#800). It writes the Drafting Checklist after it runs,
 * also after a refusal.
 *
 * `newCycle` starts the next review cycle of the Figure. {@link prepareInvocation} then asks the
 * attorney to confirm it in chat. VS Code runs {@link invoke} only after the click: a denied
 * confirmation cancels the call and a skipped one returns a skip text to the model, so the Figure
 * is not rendered and no round is used. The guard is in code, not in the prompt (#696).
 */
export class RenderFigureTool implements ICopilotTool<IRenderFigureParams> {

	public static readonly toolName = ToolName.RenderFigure;

	private promptContext: IBuildPromptContext | undefined;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	/** The editors the Drafting Checklist is revealed in: a seam for tests, which override it. */
	protected editors(): DraftingEditors {
		return vscodeEditors;
	}

	/** The date a copied sketch is named with, `yyyy-mm-dd`: a seam for tests, which override it. */
	protected today(): string {
		return new Date().toISOString().slice(0, 10);
	}

	async resolveInput(input: IRenderFigureParams, promptContext: IBuildPromptContext): Promise<IRenderFigureParams> {
		this.promptContext = promptContext;
		return input;
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IRenderFigureParams>, _token: CancellationToken): Promise<vscode.PreparedToolInvocation> {
		const input = options.input;
		const label = `${input.figure}${input.partial ?? ''}`;
		const invocationMessage = l10n.t`Rendering FIG. ${label} of ${input.matter}`;
		if (input.newCycle !== true) {
			return { invocationMessage };
		}
		const cycle = await this.nextCycle(input);
		if (cycle === undefined) {
			// The call refuses anyway (no matter or a bad Figure): nothing to confirm.
			return { invocationMessage };
		}
		return {
			invocationMessage,
			confirmationMessages: {
				title: l10n.t`Start Review Cycle`,
				message: l10n.t`Start review cycle ${cycle} for FIG. ${label}? Three more rounds.`,
			},
		};
	}

	/** The cycle a `newCycle` call starts, or `undefined` when the call refuses before it renders. */
	private async nextCycle(input: IRenderFigureParams): Promise<number | undefined> {
		const figure = figureId(input.figure, input.partial);
		if (typeof figure === 'string') {
			return undefined;
		}
		const workspace = await DraftingWorkspace.locate(input.matter, this.workspaceService, this.fileSystemService, this.instantiationService, this.editors());
		if (typeof workspace === 'string') {
			return undefined;
		}
		const files = workspace.matterFiles();
		const { state } = await readReviewState(files, figure);
		return state.used > 0 ? state.cycle + 1 : state.cycle;
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IRenderFigureParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const input = options.input;
		const workspace = await DraftingWorkspace.locate(input.matter, this.workspaceService, this.fileSystemService, this.instantiationService, this.editors());
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const seen = input.includeRender !== false && options.model?.capabilities.supportsImageToText !== false;
		const result = await renderFigureOp(workspace.matterFiles(), { figure: input.figure, partial: input.partial, scene: input.scene, flowchart: input.flowchart, block: input.block, seen, newCycle: input.newCycle === true }, {
			approvedClaims: async () => {
				const approval = await workspace.requireApprovedClaims();
				return typeof approval === 'string' ? approval : { text: await workspace.read(workspace.folder.claims) ?? '' };
			},
		});
		if (!result.ok) {
			return workspace.refusal(refused, result.reason);
		}
		const sketches = await copyAttachedSketches(workspace.matterFiles(), attachedImages(this.promptContext, this.fileSystemService), `${input.figure}${input.partial ?? ''}`, this.today());
		const text = sketches.length ? `${result.text}\nCopied the attached ${sketches.length === 1 ? 'sketch' : 'sketches'} to ${workspace.folder.folder}/sketches/: ${sketches.map(sketch => sketch.slice('sketches/'.length)).join(', ')}.` : result.text;
		const parts: (LanguageModelTextPart | LanguageModelDataPart)[] = [new LanguageModelTextPart(await workspace.textWithChecklistLine(text))];
		if (result.seen) {
			parts.push(LanguageModelDataPart.image(result.png, 'image/png'));
		}
		return new LanguageModelToolResult(parts);
	}
}

ToolRegistry.registerTool(RenderFigureTool);
