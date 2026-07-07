/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { PdfMetadata } from './extension';

/**
 * OCR Image from backend
 */
interface OcrImage {
	id: string;
	base64: string;
	mimeType: string;
}

/**
 * OCR Response from backend
 */
interface OcrResponse {
	success: boolean;
	markdown: string;
	pages: Array<{ pageNumber: number; markdown: string }>;
	images: OcrImage[];
	pageCount: number;
	processingTimeMs: number;
	error?: { message: string };
}

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

/**
 * Resolve the FlowLeap (Patent AI) backend API base URL from environment and settings.
 *
 * This mirrors `getPatentAIConfig` in the copilot extension by hand: pdf-preview cannot
 * import from the copilot extension, so the resolution order (env var > setting > production
 * default) and the `patent.apiUrl` key must be kept in sync manually.
 *
 * The returned base URL includes the `/v1` version suffix (e.g. `https://api.flowleap.co/v1`),
 * with any trailing slash stripped so callers can safely append `/ocr` etc.
 */
function resolvePatentApiUrl(): string {
	const config = vscode.workspace.getConfiguration('patent');
	const apiUrl = process.env.PATENT_API_URL || config.get<string>('apiUrl') || 'https://api.flowleap.co/v1';
	return apiUrl.replace(/\/+$/, '');
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
	 * Extract text using Mistral OCR via backend API.
	 * Returns markdown-formatted text and extracted images.
	 */
	async extractWithOCR(uri: vscode.Uri): Promise<{ markdown: string; images: OcrImage[] }> {
		// Resolve the backend API base URL (env var > setting > production default). The base
		// already includes the `/v1` suffix, so the OCR route is derived by appending `/ocr`.
		const backendUrl = resolvePatentApiUrl();
		const ocrUrl = `${backendUrl}/ocr`;

		// Read PDF file and convert to base64
		const data = await vscode.workspace.fs.readFile(uri);
		const base64Data = Buffer.from(data).toString('base64');

		// Get filename from URI
		const filename = uri.path.split('/').pop() || 'document.pdf';

		this._logger.info(`Starting OCR for: ${filename}`);

		// /v1/ocr sits behind the FlowLeap auth + subscription guard chain, so the
		// request must carry the FlowLeap session token like every other patent-data call.
		const session = await vscode.authentication.getSession('flowleap', [], { createIfNone: false });
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (session) {
			headers['Authorization'] = `Bearer ${session.accessToken}`;
		}

		try {
			// Call backend OCR endpoint
			const response = await fetch(ocrUrl, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					file: base64Data,
					filename: filename,
				}),
			});

			if (!response.ok) {
				if (response.status === 401) {
					throw new Error(session
						? 'Your FlowLeap session has expired. Please sign in again to use OCR.'
						: 'OCR requires a FlowLeap account. Please sign in to FlowLeap and try again.');
				}
				if (response.status === 402) {
					throw new Error('OCR requires an active FlowLeap subscription or trial.');
				}
				const errorText = await response.text();
				throw new Error(`OCR request failed: ${response.status} ${errorText}`);
			}

			const result = await response.json() as OcrResponse;

			if (!result.success) {
				throw new Error(result.error?.message || 'OCR processing failed');
			}

			this._logger.info(`OCR completed: ${result.pageCount} pages, ${result.images?.length || 0} images in ${result.processingTimeMs}ms`);

			return {
				markdown: result.markdown,
				images: result.images || [],
			};

		} catch (error) {
			this._logger.error(`OCR error: ${error instanceof Error ? error.message : String(error)}`);

			if (error instanceof Error && error.message.includes('fetch')) {
				throw new Error(`Cannot connect to FlowLeap backend at ${backendUrl}. Make sure the backend is running.`);
			}

			throw error;
		}
	}

	/**
	 * Check if OCR service is available
	 */
	async isOCRAvailable(): Promise<boolean> {
		const backendUrl = resolvePatentApiUrl();

		try {
			const response = await fetch(`${backendUrl}/ocr/health`, {
				method: 'GET',
			});

			if (!response.ok) {
				return false;
			}

			const result = await response.json() as { status: string; configured: boolean };
			return result.status === 'ok' && result.configured;

		} catch {
			return false;
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
