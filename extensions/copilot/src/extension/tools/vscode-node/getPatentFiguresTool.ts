/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { decodeBase64 } from '../../../util/vs/base/common/buffer';
import { LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface IGetPatentFiguresParams {
	/** Patent publication number, e.g. "EP1234567", "US10000000B2" (hyphens optional). */
	publicationNumber: string;
	/** Optional comma-separated page numbers, e.g. "1,2,3". Defaults to the first several pages. */
	pages?: string;
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
 * Routes through the shared {@link IPatentBackendClient} seam for centralized `401`/`402` gating.
 */
export class GetPatentFiguresTool implements ICopilotTool<IGetPatentFiguresParams> {

	public static readonly toolName = ToolName.GetPatentFigures;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetPatentFiguresParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching patent figures for ${publicationNumber}...`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentFiguresParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { publicationNumber, pages } = options.input;
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

			return new LanguageModelToolResult(parts);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetPatentFiguresTool]', err => `Error fetching figures for ${publicationNumber}: ${err.status} - ${err.message}`);
		}
	}
}

ToolRegistry.registerTool(GetPatentFiguresTool);
