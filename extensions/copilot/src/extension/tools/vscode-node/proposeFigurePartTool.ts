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
import { IBuildPromptContext } from '../../prompt/common/intents';
import { formatFigurePart, NumeralScheme, readFiguresSettings } from '../common/drafting/figures';
import { parseDraftingFrontmatter } from '../common/drafting/frontmatter';
import { figureHeadingNumbers, FigurePart, hasFigure, parseFigureParts, parseFigureSections } from '../common/drafting/specValidators';
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

/** File extensions a sketch may have. */
const SKETCH_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|pdf)$/i;

/** One image attached to the chat request. */
interface AttachedImage {
	readonly names: readonly string[];
	readonly fileName: string;
	readonly bytes: () => Promise<Uint8Array>;
}

function leadingNumber(numeral: string): number {
	return Number.parseInt(numeral, 10);
}

/** The reason a numeral does not follow the scheme, or `undefined` when it does. */
function schemeFault(numeral: string, scheme: NumeralScheme, figure: number): string | undefined {
	const value = leadingNumber(numeral);
	if (scheme === 'even') {
		return value % 2 ? `Numeral ${numeral} is odd; figures.md uses \`numerals: even\`.` : undefined;
	}
	return Math.floor(value / 100) !== figure ? `Numeral ${numeral} does not start with ${figure}; figures.md uses \`numerals: hundreds\`, so a part first drawn in FIG. ${figure} takes ${figure}02 to ${figure}98.` : undefined;
}

/** The next free numeral of the scheme, or `undefined` when the series of the figure is full. */
function nextNumeral(parts: readonly FigurePart[], scheme: NumeralScheme, figure: number): string | undefined {
	const values = parts.map(part => leadingNumber(part.numeral));
	if (scheme === 'even') {
		const highest = Math.max(0, ...values);
		return String(highest + (highest % 2 ? 1 : 2));
	}
	const base = figure * 100;
	const highest = Math.max(base, ...values.filter(value => Math.floor(value / 100) === figure));
	const next = highest + (highest % 2 ? 1 : 2);
	return next < base + 100 ? String(next) : undefined;
}

/** A file name safe to write in `sketches/`. */
function sketchFileName(name: string, mimeType?: string): string {
	let file = basename(name.replace(/\\/g, '/')).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'sketch';
	if (!SKETCH_EXTENSIONS.test(file)) {
		const extension = mimeType?.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
		file = `${file}.${extension && /^[a-z]+$/.test(extension) ? extension : 'png'}`;
	}
	return file;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Proposes a part the disclosure does not state (PRD 0023, slice D5): appends
 * `- NN: <part> (proposed from sketches/<file>)` under the figure heading of `figures.md`, with the
 * next free numeral of the scheme when none is given. It refuses a numeral already used or outside
 * the scheme. A sketch attached in chat, or one in the workspace, is copied to
 * `drafting/<matter>/sketches/` and named in the proposal. Export stays blocked until the attorney
 * confirms the part.
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
		const { folder } = workspace;
		const refusal = (reason: string) => textResult(`${refused} ${reason}`);
		const part = input.part?.trim().replace(/\s+/g, ' ');
		if (!part || /[\[\]()]/.test(part)) {
			return refusal('Give the part name in `part`, without brackets or parentheses.');
		}
		if (!Number.isInteger(input.figure) || input.figure < 1) {
			return refusal('Give the figure number the part is drawn in, in `figure`.');
		}
		const features = (input.features ?? []).map(feature => feature.trim().toUpperCase());
		if (features.some(feature => !/^F\d+$/.test(feature))) {
			return refusal('A Feature List link is a row id such as `F3`.');
		}
		const figures = await workspace.read(folder.figures);
		if (figures === undefined) {
			return refusal(`${folder.figures} does not exist.`);
		}
		const scheme = readFiguresSettings(figures).numerals;
		const parts = parseFigureParts(figures);
		let numeral = input.numeral?.trim();
		if (numeral) {
			if (!/^\d{1,4}[a-z]?$/.test(numeral)) {
				return refusal(`"${numeral}" is not a reference numeral (digits, then an optional small letter).`);
			}
			const used = parts.find(item => item.numeral === numeral);
			if (used) {
				return refusal(`Numeral ${numeral} is already used for "${used.part}" (${folder.figures}, line ${used.line}). One numeral names one part.`);
			}
			const fault = schemeFault(numeral, scheme, input.figure);
			if (fault) {
				return refusal(fault);
			}
		} else {
			numeral = nextNumeral(parts, scheme, input.figure);
			if (!numeral) {
				return refusal(`FIG. ${input.figure} has no free numeral left in the ${input.figure}02 to ${input.figure}98 series.`);
			}
		}

		let source: string | undefined;
		if (input.sketch?.trim()) {
			const sketch = await this.copySketch(workspace, input.sketch.trim());
			if (typeof sketch !== 'string') {
				return refusal(sketch.reason);
			}
			source = sketch;
		}

		const line = formatFigurePart({ numeral, part, ...(features.length ? { features } : {}), proposed: source ? { source } : {} });
		await workspace.write(folder.figures, insertPartLine(figures, input.figure, line));
		return textResult(`Wrote to ${folder.figures}: \`${line}\`${source ? `. The sketch is at ${folder.folder}/${source}` : ''}. This part is a proposal: build_drawing_set and the export stay blocked until the attorney confirms it by removing "(proposed)", or deletes the line. Tell the attorney what you proposed and why.`);
	}

	/** Copies the sketch to `sketches/` and returns its path relative to the matter folder, or the refusal. */
	private async copySketch(workspace: DraftingWorkspace, sketch: string): Promise<string | { readonly reason: string }> {
		const { folder } = workspace;
		const sketchFolder = `${folder.folder}/sketches`;
		const attached = this.attachedImages();
		const wanted = sketch.toLowerCase();
		const image = attached.find(item => item.names.some(name => name.toLowerCase() === wanted || basename(name).toLowerCase() === basename(wanted)));
		let bytes: Uint8Array | undefined;
		let fileName: string;
		if (image) {
			bytes = await image.bytes();
			fileName = image.fileName;
		} else {
			const relative = sketch.replace(/\\/g, '/').replace(/^\.?\//, '');
			const path = relative.startsWith('sketches/') ? `${folder.folder}/${relative}` : relative;
			if (path.startsWith(`${sketchFolder}/`)) {
				return await workspace.exists(path) ? path.slice(folder.folder.length + 1) : { reason: `${path} does not exist.` };
			}
			bytes = SKETCH_EXTENSIONS.test(path) && !path.split('/').includes('..') ? await workspace.readBytes(path) : undefined;
			if (!bytes) {
				const names = attached.map(item => item.fileName);
				return { reason: `"${sketch}" is neither an image attached in this chat${names.length ? ` (attached: ${names.join(', ')})` : ' (none is attached)'} nor an image file in the workspace.` };
			}
			fileName = sketchFileName(path);
		}
		const dot = fileName.lastIndexOf('.');
		for (let index = 1; ; index++) {
			const candidate = index === 1 ? fileName : `${fileName.slice(0, dot)}-${index}${fileName.slice(dot)}`;
			const target = `${sketchFolder}/${candidate}`;
			const existing = await workspace.readBytes(target);
			if (!existing) {
				await workspace.write(target, bytes);
				return `sketches/${candidate}`;
			}
			if (sameBytes(existing, bytes)) {
				return `sketches/${candidate}`;
			}
		}
	}

	/** The images attached to the chat request this tool call belongs to. */
	private attachedImages(): AttachedImage[] {
		const images: AttachedImage[] = [];
		for (const variable of this.promptContext?.chatVariables ?? []) {
			const value = variable.value;
			const names = [variable.originalName, variable.uniqueName, variable.reference.name].filter(Boolean);
			if (value instanceof ChatReferenceBinaryData && value.mimeType.startsWith('image/')) {
				const reference = value.reference ? basename(value.reference.path) : undefined;
				images.push({ names: reference ? [...names, reference] : names, fileName: sketchFileName(reference ?? variable.originalName, value.mimeType), bytes: async () => value.data() });
			} else if (URI.isUri(value) && SKETCH_EXTENSIONS.test(value.path)) {
				images.push({ names: [...names, basename(value.path)], fileName: sketchFileName(value.path), bytes: () => this.fileSystemService.readFile(value, true) });
			}
		}
		return images;
	}
}

/**
 * Inserts a part line under the heading of the figure: after the last part line of its section,
 * or right after the heading. A figure without a heading gets one at the end of the file.
 */
function insertPartLine(figures: string, figure: number, line: string): string {
	const section = parseFigureSections(figures).figures.find(item => hasFigure(figureHeadingNumbers(item.label), String(figure)));
	const lines = figures.replace(/\r\n/g, '\n').split('\n');
	if (!section) {
		const body = lines.join('\n').replace(/\n*$/, '');
		const empty = parseDraftingFrontmatter(figures).body.trim() === '';
		return `${body}${empty ? '\n' : '\n\n'}## FIG. ${figure}\n\n${line}\n`;
	}
	const after = section.parts.length ? section.parts[section.parts.length - 1].line : section.line;
	const insert = section.parts.length ? [line] : ['', line];
	lines.splice(after, 0, ...insert);
	return lines.join('\n');
}

ToolRegistry.registerTool(ProposeFigurePartTool);
