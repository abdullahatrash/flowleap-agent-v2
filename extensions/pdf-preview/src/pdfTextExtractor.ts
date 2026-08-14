/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { PdfMetadata } from './extension';

/**
 * OCR Image, as the Patent AI OCR bridge reports it.
 */
interface OcrImage {
	id: string;
	base64: string;
	mimeType: string;
}

/**
 * The command Patent AI registers for Document OCR, and the outcome it answers with. Hand-mirrored
 * from `patentai/common/ocrBridge.ts`, which this extension cannot import — the same manual
 * mirroring the consent command id already documents.
 *
 * The bridge answers rather than throws, because a rejection thrown across `executeCommand` arrives
 * as a bare message: the CODE is what tells "sign in" from "start your trial" from "wait and retry",
 * and this side must never branch on message wording (backend policy makes wording editable).
 */
const OCR_RUN_COMMAND_ID = 'flowleap.ocr.run';

type OcrBridgeErrorCode =
	| 'auth_required'
	| 'subscription_required'
	| 'data_keys_required'
	| 'patent_provider_key_invalid'
	| 'rate_limited'
	| 'transient'
	| 'cancelled'
	| 'backend_error'
	| 'unavailable';

type OcrBridgeOutcome =
	| { ok: true; markdown: string; images: OcrImage[]; pageCount: number }
	| { ok: false; code: OcrBridgeErrorCode; message: string };

// PDF.js types (simplified)
interface PDFDocumentProxy {
	numPages: number;
	getPage(pageNumber: number): Promise<PDFPageProxy>;
	getMetadata(): Promise<{ info: Record<string, unknown> }>;
}

interface PDFPageProxy {
	getTextContent(): Promise<{ items: TextItem[] }>;
}

interface TextItem {
	str: string;
	transform: number[];
	fontName?: string;
}

interface PDFDocumentLoadingTask {
	promise: Promise<PDFDocumentProxy>;
}

interface PDFJSLib {
	getDocument(options: { data: Uint8Array; useSystemFonts?: boolean; disableAutoFetch?: boolean; disableStream?: boolean; isEvalSupported?: boolean }): PDFDocumentLoadingTask;
	GlobalWorkerOptions: { workerSrc: string };
}

let pdfjsLib: PDFJSLib | null = null;

async function getPdfJs(extensionPath: string): Promise<PDFJSLib> {
	if (!pdfjsLib) {
		// Use dynamic import for ESM module
		const pdfjsPath = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs').fsPath;
		const workerPath = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs').fsPath;

		try {
			// pdfjs-dist ships ESM-only, so a static import can't work from the CJS extension host
			// eslint-disable-next-line no-restricted-syntax
			const pdfjs = await import(/* webpackIgnore: true */ pdfjsPath);
			pdfjsLib = pdfjs as unknown as PDFJSLib;

			// Set up the worker path
			pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
		} catch (err) {
			console.error('[PDF Preview] Failed to load PDF.js:', err);
			throw new Error(`Failed to load PDF.js library: ${err}`);
		}
	}
	return pdfjsLib;
}

interface CachedPdf {
	document: PDFDocumentProxy;
	timestamp: number;
}

/**
 * Extracts text and metadata from PDF files.
 * This is the core functionality exposed to other extensions (like patentai).
 */
export class PdfTextExtractor {
	private readonly _cache = new Map<string, CachedPdf>();
	private readonly _maxCacheSize = 10;
	private readonly _extensionPath: string;
	private readonly _logger: vscode.LogOutputChannel;

	constructor(extensionPath: string, logger: vscode.LogOutputChannel) {
		this._extensionPath = extensionPath;
		this._logger = logger;
	}

	/**
	 * Extract all text from a PDF file
	 */
	async extractAllText(uri: vscode.Uri): Promise<string> {
		const pdf = await this._loadPdf(uri);
		const textParts: string[] = [];

		for (let i = 1; i <= pdf.numPages; i++) {
			const pageText = await this._extractPageText(pdf, i);
			textParts.push(`--- Page ${i} ---\n${pageText}`);
		}

		return textParts.join('\n\n');
	}

	/**
	 * Extract text from a specific page
	 */
	async getPageText(uri: vscode.Uri, pageNumber: number): Promise<string> {
		const pdf = await this._loadPdf(uri);

		if (pageNumber < 1 || pageNumber > pdf.numPages) {
			throw new Error(`Invalid page number: ${pageNumber}. PDF has ${pdf.numPages} pages.`);
		}

		return this._extractPageText(pdf, pageNumber);
	}

	/**
	 * Extract text from a range of pages
	 */
	async extractTextFromPages(uri: vscode.Uri, startPage: number, endPage: number): Promise<string> {
		const pdf = await this._loadPdf(uri);

		const start = Math.max(1, startPage);
		const end = Math.min(pdf.numPages, endPage);

		const textParts: string[] = [];
		for (let i = start; i <= end; i++) {
			const pageText = await this._extractPageText(pdf, i);
			textParts.push(`--- Page ${i} ---\n${pageText}`);
		}

		return textParts.join('\n\n');
	}

	/**
	 * Get PDF metadata
	 */
	async getMetadata(uri: vscode.Uri): Promise<PdfMetadata> {
		const pdf = await this._loadPdf(uri);
		const metadata = await pdf.getMetadata();
		const info = metadata.info as Record<string, unknown>;

		return {
			title: info?.Title as string | undefined,
			author: info?.Author as string | undefined,
			subject: info?.Subject as string | undefined,
			keywords: info?.Keywords as string | undefined,
			creator: info?.Creator as string | undefined,
			producer: info?.Producer as string | undefined,
			creationDate: this._parseDate(info?.CreationDate as string),
			modificationDate: this._parseDate(info?.ModDate as string),
			pageCount: pdf.numPages,
			isEncrypted: false,
		};
	}

	/**
	 * Extract text with Document OCR, through Patent AI's backend seam.
	 * Returns markdown-formatted text, extracted images, and the processed page count.
	 * When a cancellation token is supplied, cancelling aborts the in-flight request.
	 *
	 * The call goes through the {@link OCR_RUN_COMMAND_ID} command rather than this extension's own
	 * `fetch`, so the upload inherits the one client every other FlowLeap call uses: the session
	 * token, the BYO patent-data key headers, the client-version header, retry-with-backoff, and the
	 * centralized gating that shows the user a Sign In / Start Trial / Add Keys action. This side
	 * only turns the returned CODE into a sentence.
	 *
	 * Fails CLOSED, like the consent gate beside it: if the command is missing — Patent AI not
	 * activated — there is no seam to upload through, so nothing is uploaded.
	 */
	async extractWithOCR(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<{ markdown: string; images: OcrImage[]; pageCount: number }> {
		// Read PDF file and convert to base64
		const data = await vscode.workspace.fs.readFile(uri);
		const base64Data = Buffer.from(data).toString('base64');

		// Get filename from URI
		const filename = uri.path.split('/').pop() || 'document.pdf';

		this._logger.info(`Starting OCR for: ${filename}`);

		let outcome: OcrBridgeOutcome;
		try {
			outcome = await vscode.commands.executeCommand<OcrBridgeOutcome>(
				OCR_RUN_COMMAND_ID, { file: base64Data, filename }, token);
		} catch (err) {
			this._logger.error(`OCR bridge unavailable: ${err instanceof Error ? err.message : String(err)}`);
			throw new Error(vscode.l10n.t('Text extraction is unavailable because FlowLeap Patent AI is not running.'));
		}

		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		if (!outcome?.ok) {
			const code = outcome?.code ?? 'backend_error';
			if (code === 'cancelled') {
				throw new vscode.CancellationError();
			}
			this._logger.error(`OCR error (${code}): ${outcome?.message ?? 'no outcome returned'}`);
			throw new Error(this._ocrFailureMessage(code, outcome?.message));
		}

		this._logger.info(`OCR completed: ${outcome.pageCount} pages, ${outcome.images?.length || 0} images`);

		return {
			markdown: outcome.markdown,
			images: outcome.images || [],
			pageCount: outcome.pageCount,
		};
	}

	/**
	 * Turn a bridge error code into a sentence for the user. Branching on the CODE, never on the
	 * message text: the backend is free to reword, and Patent AI has already shown the actionable
	 * notification (Sign In, Start Trial, Add Patent Data Keys) for the gated codes.
	 */
	private _ocrFailureMessage(code: OcrBridgeErrorCode, detail: string | undefined): string {
		switch (code) {
			case 'auth_required':
				return vscode.l10n.t('Text extraction requires a FlowLeap account. Sign in to FlowLeap and try again.');
			case 'subscription_required':
				return vscode.l10n.t('Text extraction requires an active FlowLeap subscription or trial.');
			case 'data_keys_required':
			case 'patent_provider_key_invalid':
				return vscode.l10n.t('Text extraction needs your FlowLeap patent-data keys. Add or update them in FlowLeap Settings, then try again.');
			case 'rate_limited':
				return vscode.l10n.t('FlowLeap is rate-limiting requests right now. Wait a few seconds and try again.');
			case 'transient':
				return vscode.l10n.t('The FlowLeap backend is temporarily unavailable. Wait briefly and try again.');
			case 'unavailable':
				return vscode.l10n.t('Text extraction is unavailable because FlowLeap Patent AI is not running.');
			default:
				return detail
					? vscode.l10n.t('Text extraction failed: {0}', detail)
					: vscode.l10n.t('Text extraction failed.');
		}
	}

	private async _loadPdf(uri: vscode.Uri): Promise<PDFDocumentProxy> {
		const key = uri.toString();
		const cached = this._cache.get(key);

		if (cached && cached.timestamp > Date.now() - 60000) {
			// Cache valid for 1 minute
			return cached.document;
		}

		const pdfjs = await getPdfJs(this._extensionPath);
		const data = await vscode.workspace.fs.readFile(uri);

		const loadingTask = pdfjs.getDocument({
			data: data,
			useSystemFonts: true,
			disableAutoFetch: true,
			disableStream: true,
			isEvalSupported: false,
		});

		const pdf = await loadingTask.promise;

		// Manage cache size
		if (this._cache.size >= this._maxCacheSize) {
			const oldestKey = this._cache.keys().next().value;
			if (oldestKey) {
				this._cache.delete(oldestKey);
			}
		}

		this._cache.set(key, {
			document: pdf,
			timestamp: Date.now(),
		});

		return pdf;
	}

	private async _extractPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
		const page = await pdf.getPage(pageNumber);
		const textContent = await page.getTextContent();

		const textItems = textContent.items as TextItem[];

		// Sort by vertical position (y coordinate), then horizontal (x coordinate)
		// This helps maintain reading order
		const sortedItems = textItems
			.filter(item => item.str.trim().length > 0)
			.sort((a, b) => {
				const yDiff = b.transform[5] - a.transform[5]; // Y is inverted in PDF
				if (Math.abs(yDiff) > 5) { // Same line threshold
					return yDiff;
				}
				return a.transform[4] - b.transform[4]; // X position
			});

		// Group items by lines (based on Y position)
		const lines: string[][] = [];
		let currentLine: string[] = [];
		let lastY: number | null = null;

		for (const item of sortedItems) {
			const y = item.transform[5];

			if (lastY !== null && Math.abs(y - lastY) > 5) {
				// New line
				if (currentLine.length > 0) {
					lines.push(currentLine);
				}
				currentLine = [];
			}

			currentLine.push(item.str);
			lastY = y;
		}

		if (currentLine.length > 0) {
			lines.push(currentLine);
		}

		return lines.map(line => line.join(' ')).join('\n');
	}

	private _parseDate(dateStr: string | undefined): Date | undefined {
		if (!dateStr) {
			return undefined;
		}

		// PDF dates are in format: D:YYYYMMDDHHmmss
		const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
		if (match) {
			const [, year, month, day, hour = '0', min = '0', sec = '0'] = match;
			return new Date(
				parseInt(year),
				parseInt(month) - 1,
				parseInt(day),
				parseInt(hour),
				parseInt(min),
				parseInt(sec)
			);
		}

		return undefined;
	}
}
