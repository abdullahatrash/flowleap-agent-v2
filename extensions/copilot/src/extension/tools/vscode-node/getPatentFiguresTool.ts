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
import { decodeBase64 } from '../../../util/vs/base/common/buffer';
import { joinPath } from '../../../util/vs/base/common/resources';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { assertFileOkForTool } from '../node/toolUtils';

interface IGetPatentFiguresParams {
	/** Patent publication number, e.g. "EP1234567", "US10000000B2" (hyphens optional). */
	publicationNumber: string;
	/** Optional comma-separated page numbers, e.g. "1,2,3". Defaults to the first several pages. */
	pages?: string;
	/** Optional workspace directory; when set, the fetched pages are also saved there as PNG files. */
	saveDir?: string;
}

interface FigureData {
	page: number;
	format: string;
	description?: string;
	base64?: string;
}

/**
 * `data` payload of the `get_patent_image` facade tool. Metadata-only calls return the image-inquiry
 * shape (no `figures`); with `include_images` the same shape carries the base64 pages.
 */
interface FiguresData {
	docId: string;
	/** Present on an image-fetching call; metadata-only calls report page counts per format instead. */
	totalFigures?: number;
	availableFormats?: string[];
	formats?: { format: string; pages: number; drawingStartPage?: number }[];
	/** 1-based page where the DRAWINGS section starts (earlier pages are cover/biblio/description). */
	drawingStartPage?: number;
	figures?: FigureData[];
}

/** Default number of figure pages to fetch when the caller does not specify `pages`. */
const DEFAULT_MAX_PAGES = 8;

/** Maximum number of pages a caller may request via `pages`, matching the tool's input schema. */
const MAX_REQUESTED_PAGES = 20;

/** PNG rendering on the backend can be slow, so allow a longer timeout for the image fetch. */
const FIGURE_RENDER_TIMEOUT_MS = 60_000;

/**
 * Tool for retrieving patent figure/drawing images through the FlowLeap backend's `get_patent_image`
 * facade tool (EPO OPS images).
 *
 * The tool call returns base64 page images inside the JSON envelope — metadata first (to learn the
 * page count and where the drawings start), then the selected pages with `include_images` and
 * `render: 'png'`, since EPO serves most patents as PDF only and a PDF cannot be shown as an image.
 * The pages come back as inline image parts so the model can actually see and analyze the figures.
 * The inline parts exist only in the chat response — they are never files on disk — so `saveDir`
 * writes the same pages as PNG files into the workspace when the user wants them saved.
 * Routes through the shared {@link IPatentBackendClient} seam for centralized `401`/`402` gating.
 */
export class GetPatentFiguresTool implements ICopilotTool<IGetPatentFiguresParams> {

	public static readonly toolName = ToolName.GetPatentFigures;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetPatentFiguresParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber, saveDir } = options.input;
		if (saveDir?.trim()) {
			return {
				invocationMessage: l10n.t`Fetching patent figures for ${publicationNumber}...`,
				confirmationMessages: {
					title: l10n.t`Save Patent Figures`,
					message: l10n.t`Allow Patent AI to save the figure images of ${publicationNumber} into ${saveDir}?`
				}
			};
		}
		return {
			invocationMessage: l10n.t`Fetching patent figures for ${publicationNumber}...`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentFiguresParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { publicationNumber, pages, saveDir } = options.input;
		this.logService.info(`[GetPatentFiguresTool] Fetching figures for ${publicationNumber}${pages ? ` pages=${pages}` : ''}`);

		try {
			// Step 1: fetch metadata (no images) to learn the page count and where the
			// DRAWINGS section starts. EPO image links include cover/biblio/description
			// pages first, so the actual drawings usually begin partway through.
			const meta = await callFacadeTool<FiguresData>(
				this.patentBackendClient, 'get_patent_image', { patent_number: publicationNumber }, token);

			const docId = meta.docId || publicationNumber;
			// Metadata-only calls report per-format page counts. Prefer the PDF entry: rendering to
			// PNG rasterizes the PDF source, which is the only format most patents have.
			const source = meta.formats?.find(f => f.format === 'pdf') ?? meta.formats?.[0];
			const totalFigures = source?.pages ?? 0;
			const drawingStartPage = source?.drawingStartPage;
			if (totalFigures < 1) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`No figure images are available for ${docId}.`)
				]);
			}

			// Step 2: decide which pages to fetch. If the caller specified pages, honor them.
			// Otherwise default to the DRAWINGS section (drawingStartPage..end), capped.
			const userSelected = !!pages?.trim();
			const startPage = (!userSelected && drawingStartPage && drawingStartPage <= totalFigures) ? drawingStartPage : 1;
			const selectedPages = userSelected
				// The schema documents a max of MAX_REQUESTED_PAGES; keep only valid page
				// numbers and cap the count so an over-long request can't be forwarded raw.
				? pages!.split(',')
					.map(p => Number(p.trim()))
					.filter(p => Number.isInteger(p) && p >= 1)
					.slice(0, MAX_REQUESTED_PAGES)
				: Array.from(
					{ length: Math.min(DEFAULT_MAX_PAGES, totalFigures - startPage + 1) },
					(_, i) => startPage + i
				);
			const pagesParam = selectedPages.join(',');

			// Step 3: fetch the selected pages as rendered PNGs, base64 inside the tool envelope.
			const imgResult = await callFacadeTool<FiguresData>(
				this.patentBackendClient,
				'get_patent_image',
				{ patent_number: publicationNumber, include_images: true, render: 'png', pages: selectedPages },
				token,
				{ timeoutMs: FIGURE_RENDER_TIMEOUT_MS }
			);
			const figures = imgResult.figures ?? [];
			const withImages = figures.filter(f => f.base64);

			if (withImages.length === 0) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`No figure images could be retrieved for ${docId} (pages ${pagesParam}).`)
				]);
			}

			const parts: (LanguageModelTextPart | LanguageModelDataPart)[] = [];

			let header: string;
			if (userSelected) {
				header = `Patent ${docId} has ${totalFigures} page(s). Showing requested pages ${pagesParam}:`;
			} else if (startPage > 1) {
				const lastShown = startPage + withImages.length - 1;
				header = `Patent ${docId} has ${totalFigures} page(s); the drawings begin on page ${startPage}. Showing drawing pages ${startPage}–${lastShown}:`;
			} else {
				header = `Patent ${docId} has ${totalFigures} page(s). Showing pages ${pagesParam}:`;
			}
			parts.push(new LanguageModelTextPart(header));

			for (const fig of withImages) {
				parts.push(new LanguageModelTextPart(`\nPage ${fig.page}:`));
				// render=png means base64 is always a PNG image.
				parts.push(LanguageModelDataPart.image(decodeBase64(fig.base64!).buffer, 'image/png'));
			}

			// Note any remaining pages the caller can request explicitly.
			const lastShown = (withImages[withImages.length - 1]?.page) ?? 0;
			if (!userSelected && totalFigures > lastShown) {
				parts.push(new LanguageModelTextPart(
					`\n${totalFigures - lastShown} more page(s) available (up to page ${totalFigures}). To view them, call this tool again with the "pages" parameter (e.g. pages="${lastShown + 1},${lastShown + 2}").`
				));
			}

			if (saveDir?.trim()) {
				parts.push(new LanguageModelTextPart(await this.savePages(saveDir.trim(), docId, withImages)));
			}

			return new LanguageModelToolResult(parts);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetPatentFiguresTool]', err => `Error fetching figures for ${publicationNumber}: ${err.status} - ${err.message}`);
		}
	}

	/**
	 * Resolves `saveDir` to a URI. {@link IPromptPathRepresentationService.resolveFilePath} accepts
	 * only absolute paths, but the tool documents relative paths too (e.g. 'figures'), so those are
	 * resolved against the first workspace folder.
	 */
	private resolveSaveDir(saveDir: string): vscode.Uri | undefined {
		const absolute = this.promptPathRepresentationService.resolveFilePath(saveDir);
		if (absolute) {
			return absolute;
		}
		const workspaceFolder = this.workspaceService.getWorkspaceFolders()[0];
		if (!workspaceFolder) {
			return undefined;
		}
		// Normalize Windows-style separators before joining path fragments.
		const fragments = saveDir.replace(/\\/g, '/').split('/').filter(fragment => fragment.length > 0);
		return fragments.length > 0 ? joinPath(workspaceFolder, ...fragments) : workspaceFolder;
	}

	/**
	 * Saves the fetched pages as PNG files under `saveDir` and reports the outcome as a text line.
	 * A save failure must not discard the images already fetched, so errors are reported in the
	 * result text instead of failing the whole tool call.
	 */
	private async savePages(saveDir: string, docId: string, figures: FigureData[]): Promise<string> {
		const dirUri = this.resolveSaveDir(saveDir);
		if (!dirUri) {
			return `\nCould not save the images: "${saveDir}" is not a valid directory path. Provide a folder inside the workspace.`;
		}
		try {
			const safeDocId = docId.replace(/[^A-Za-z0-9.-]/g, '') || 'patent';
			const targets = figures.map(fig => ({ fig, uri: joinPath(dirUri, `${safeDocId}-page-${fig.page}.png`) }));

			// Confine writes to the workspace before touching disk, exactly like write_patent_results.
			for (const { uri } of targets) {
				await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, uri));
			}

			await createDirectoryIfNotExists(this.fileSystemService, dirUri);
			const saved: string[] = [];
			for (const { fig, uri } of targets) {
				// render=png means base64 is always a PNG image.
				await this.fileSystemService.writeFile(uri, decodeBase64(fig.base64!).buffer);
				saved.push(this.promptPathRepresentationService.getFilePath(uri));
			}
			this.logService.info(`[GetPatentFiguresTool] Saved ${saved.length} page(s) of ${docId} to ${saveDir}`);
			return `\nSaved ${saved.length} PNG file(s):\n${saved.map(p => `- ${p}`).join('\n')}`;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logService.error(`[GetPatentFiguresTool] Failed to save pages to ${saveDir}: ${message}`);
			return `\nCould not save the images to "${saveDir}": ${message}. The pages above are still shown inline.`;
		}
	}
}

ToolRegistry.registerTool(GetPatentFiguresTool);
