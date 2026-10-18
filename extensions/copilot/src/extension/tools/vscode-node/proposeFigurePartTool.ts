/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { basename } from '../../../util/vs/base/common/path';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatReferenceBinaryData } from '../../../vscodeTypes';
import { SKETCH_EXTENSIONS } from '../../drawings/common/drawingFiles';
import { proposeFigurePartOp, SketchFile } from '../../drawings/node/ops/proposeFigurePartOp';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DraftingWorkspace, textResult } from './draftingWorkspace';

interface IProposeFigurePartParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
	/** The figure the part is drawn in. */
	figure: number;
	/** The part name, e.g. `bracket`. */
	part: string;
	/** The reference numeral; the next free numeral of the scheme when absent. */
	numeral?: string;
	/** The Feature List rows the part shows, e.g. `F3`. */
	features?: string[];
	/** The sketch the part comes from: the name of an image attached in chat, or a workspace path. */
	sketch?: string;
}

const refused = 'No part was proposed.';

/** One image attached to the chat request. */
interface AttachedImage {
	readonly names: readonly string[];
	readonly fileName: string;
	readonly mimeType?: string;
	readonly bytes: () => Promise<Uint8Array>;
}

/**
 * Proposes a part the disclosure does not state (PRD 0023, slice D5) through
 * {@link proposeFigurePartOp}. This tool resolves the sketch: an image attached to the chat
 * request (read in `resolveInput`), else an image file in the workspace (a path relative to the
 * workspace, or `sketches/<file>` relative to the matter). It writes the Drafting Checklist after
 * it runs, also after a refusal.
 */
export class ProposeFigurePartTool implements ICopilotTool<IProposeFigurePartParams> {

	public static readonly toolName = ToolName.ProposeFigurePart;

	private promptContext: IBuildPromptContext | undefined;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async resolveInput(input: IProposeFigurePartParams, promptContext: IBuildPromptContext): Promise<IProposeFigurePartParams> {
		this.promptContext = promptContext;
		return input;
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IProposeFigurePartParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Proposing the part "${options.input.part}" for FIG. ${options.input.figure} of ${options.input.matter}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IProposeFigurePartParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const input = options.input;
		const workspace = await DraftingWorkspace.locate(input.matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		let sketch: SketchFile | undefined;
		if (input.sketch?.trim()) {
			const resolved = await this.resolveSketch(workspace, input.sketch.trim());
			if (typeof resolved === 'string') {
				return workspace.refusal(refused, resolved);
			}
			sketch = resolved;
		}
		const result = await proposeFigurePartOp(workspace.matterFiles(), { figure: input.figure, part: input.part, numeral: input.numeral, features: input.features, sketch });
		return result.ok ? textResult(await workspace.textWithChecklistLine(result.text)) : workspace.refusal(refused, result.reason);
	}

	/** The sketch bytes: an attached image whose name matches, else a workspace image file; or the refusal. */
	private async resolveSketch(workspace: DraftingWorkspace, sketch: string): Promise<SketchFile | string> {
		const attached = this.attachedImages();
		const wanted = sketch.toLowerCase();
		const image = attached.find(item => item.names.some(name => name.toLowerCase() === wanted || basename(name).toLowerCase() === basename(wanted)));
		if (image) {
			return { name: image.fileName, bytes: await image.bytes(), mimeType: image.mimeType };
		}
		const relative = sketch.replace(/\\/g, '/').replace(/^\.?\//, '');
		const path = relative.startsWith('sketches/') ? `${workspace.folder.folder}/${relative}` : relative;
		const bytes = SKETCH_EXTENSIONS.test(path) && !path.split('/').includes('..') ? await workspace.readBytes(path) : undefined;
		if (!bytes) {
			const names = attached.map(item => item.fileName);
			return `"${sketch}" is neither an image attached in this chat${names.length ? ` (attached: ${names.join(', ')})` : ' (none is attached)'} nor an image file in the workspace.`;
		}
		return { name: path, bytes };
	}

	/** The images attached to the chat request this tool call belongs to. */
	private attachedImages(): AttachedImage[] {
		const images: AttachedImage[] = [];
		for (const variable of this.promptContext?.chatVariables ?? []) {
			const value = variable.value;
			const names = [variable.originalName, variable.uniqueName, variable.reference.name].filter(Boolean);
			if (value instanceof ChatReferenceBinaryData && value.mimeType.startsWith('image/')) {
				const reference = value.reference ? basename(value.reference.path) : undefined;
				images.push({ names: reference ? [...names, reference] : names, fileName: reference ?? variable.originalName, mimeType: value.mimeType, bytes: async () => value.data() });
			} else if (URI.isUri(value) && SKETCH_EXTENSIONS.test(value.path)) {
				images.push({ names: [...names, basename(value.path)], fileName: basename(value.path), bytes: () => this.fileSystemService.readFile(value, true) });
			}
		}
		return images;
	}
}

ToolRegistry.registerTool(ProposeFigurePartTool);
