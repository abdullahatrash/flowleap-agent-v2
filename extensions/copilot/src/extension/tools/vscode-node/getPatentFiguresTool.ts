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
import { IPatentBackendClient, PatentBackendError } from '../../patentai/vscode-node/patentBackendClient';
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

interface FiguresResponseData {
	docId: string;
	totalFigures: number;
	availableFormats: string[];
	/** 1-based page where the DRAWINGS section starts (earlier pages are cover/biblio/description). */
	drawingStartPage?: number;
	figures: FigureData[];
}

interface FiguresApiResponse {
	success: boolean;
	data?: FiguresResponseData;
	error?: string;
}

/** Default number of figure pages to fetch when the caller does not specify `pages`. */
const DEFAULT_MAX_PAGES = 8;

/** PNG rendering on the backend can be slow, so allow a longer timeout for the image fetch. */
const FIGURE_RENDER_TIMEOUT_MS = 60_000;

/**
 * Tool for retrieving patent figure/drawing images from the FlowLeap backend (EPO OPS).
 *
 * The backend rasterizes the (PDF-only) EPO drawings to PNG via `render=png`, and this tool
 * returns them as inline image parts so the model can actually see and analyze the figures.
 * Routes through the shared {@link IPatentBackendClient} seam for centralized `401`/`402` gating.
 */
class GetPatentFiguresTool implements ICopilotTool<IGetPatentFiguresParams> {

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
			const figuresPath = (qs: Record<string, string>) =>
				`/ops/figures?${new URLSearchParams({ doc: publicationNumber, ...qs }).toString()}`;

			// Step 1: fetch metadata (no images) to learn the page count and where the
			// DRAWINGS section starts. EPO image links include cover/biblio/description
			// pages first, so the actual drawings usually begin partway through.
			const meta = await this.patentBackendClient.get<FiguresApiResponse>(figuresPath({}), token);
			if (!meta.success || !meta.data) {
				const errorMsg = meta.error || `No figures found for ${publicationNumber}`;
				return new LanguageModelToolResult([new LanguageModelTextPart(errorMsg)]);
			}

			const { docId, totalFigures, drawingStartPage } = meta.data;
			if (totalFigures < 1) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`No figure images are available for ${docId}.`)
				]);
			}

			// Step 2: decide which pages to fetch. If the caller specified pages, honor them.
			// Otherwise default to the DRAWINGS section (drawingStartPage..end), capped.
			const userSelected = !!pages?.trim();
			const startPage = (!userSelected && drawingStartPage && drawingStartPage <= totalFigures) ? drawingStartPage : 1;
			const pagesParam = userSelected
				? pages!.trim()
				: Array.from(
					{ length: Math.min(DEFAULT_MAX_PAGES, totalFigures - startPage + 1) },
					(_, i) => startPage + i
				).join(',');

			// Step 3: fetch the selected pages as rendered PNGs.
			const imgResult = await this.patentBackendClient.get<FiguresApiResponse>(
				figuresPath({ include_images: 'true', render: 'png', pages: pagesParam }),
				token,
				{ timeoutMs: FIGURE_RENDER_TIMEOUT_MS }
			);
			const figures = imgResult.data?.figures ?? [];
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
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[GetPatentFiguresTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error fetching figures for ${publicationNumber}: ${error.status} - ${error.message}`)
				]);
			}
			this.logService.error(`[GetPatentFiguresTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}
}

ToolRegistry.registerTool(GetPatentFiguresTool);
