/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PdfEditorProvider } from './pdfEditorProvider';
import { PdfTextExtractor } from './pdfTextExtractor';

/**
 * PDF Preview Extension API
 * Exposed to other extensions for AI integration
 */
export interface PdfPreviewAPI {
	/**
	 * Extract all text from a PDF file
	 */
	extractText(uri: vscode.Uri): Promise<string>;

	/**
	 * Extract text from specific pages
	 */
	extractTextFromPages(uri: vscode.Uri, startPage: number, endPage: number): Promise<string>;

	/**
	 * Get PDF metadata (title, author, page count, etc.)
	 */
	getMetadata(uri: vscode.Uri): Promise<PdfMetadata>;

	/**
	 * Get text from a specific page
	 */
	getPageText(uri: vscode.Uri, pageNumber: number): Promise<string>;

	/**
	 * Get the number of pages in a PDF
	 */
	getPageCount(uri: vscode.Uri): Promise<number>;
}

export interface PdfMetadata {
	title?: string;
	author?: string;
	subject?: string;
	keywords?: string;
	creator?: string;
	producer?: string;
	creationDate?: Date;
	modificationDate?: Date;
	pageCount: number;
	isEncrypted: boolean;
}

let textExtractor: PdfTextExtractor;

/**
 * Find an open PDF to operate on. Prefers the active tab when it is a PDF, otherwise
 * returns the first PDF tab found across all groups — so the command works even when a
 * text editor currently has focus.
 */
function findActivePdfUri(): vscode.Uri | undefined {
	const isPdf = (input: unknown): input is { uri: vscode.Uri } => {
		const uri = (input as { uri?: vscode.Uri } | undefined)?.uri;
		return !!uri && uri.path.toLowerCase().endsWith('.pdf');
	};

	const activeInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (isPdf(activeInput)) {
		return activeInput.uri;
	}

	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (isPdf(tab.input)) {
				return tab.input.uri;
			}
		}
	}

	return undefined;
}

export function activate(context: vscode.ExtensionContext): PdfPreviewAPI {
	const logger = vscode.window.createOutputChannel('PDF Preview', { log: true });
	context.subscriptions.push(logger);
	logger.info('Activating extension');

	// Initialize the text extractor with the extension path for loading PDF.js
	textExtractor = new PdfTextExtractor(context.extensionPath, logger);

	// Register the custom editor provider
	const provider = new PdfEditorProvider(context, textExtractor);
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			PdfEditorProvider.viewType,
			provider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: true,
			}
		)
	);

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('pdf-preview.extractText', async () => {
			// Resolve a PDF from the open tabs. This must work even when a text editor
			// (e.g. previously extracted output) currently has focus rather than the PDF.
			const uri = findActivePdfUri();
			if (!uri) {
				vscode.window.showWarningMessage(vscode.l10n.t('No PDF file is currently active'));
				return;
			}
			const text = await textExtractor.extractAllText(uri);
			const doc = await vscode.workspace.openTextDocument({
				content: text,
				language: 'plaintext'
			});
			await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('pdf-preview.goToPage', async () => {
			const pageStr = await vscode.window.showInputBox({
				prompt: 'Enter page number',
				validateInput: (value) => {
					const num = parseInt(value);
					if (isNaN(num) || num < 1) {
						return 'Please enter a valid page number';
					}
					return null;
				}
			});
			if (pageStr) {
				provider.goToPage(parseInt(pageStr));
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('pdf-preview.zoomIn', () => {
			provider.zoom(0.25);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('pdf-preview.zoomOut', () => {
			provider.zoom(-0.25);
		})
	);

	logger.info('Extension activated');

	// Return the API for other extensions
	const api: PdfPreviewAPI = {
		async extractText(uri: vscode.Uri): Promise<string> {
			return textExtractor.extractAllText(uri);
		},

		async extractTextFromPages(uri: vscode.Uri, startPage: number, endPage: number): Promise<string> {
			return textExtractor.extractTextFromPages(uri, startPage, endPage);
		},

		async getMetadata(uri: vscode.Uri): Promise<PdfMetadata> {
			return textExtractor.getMetadata(uri);
		},

		async getPageText(uri: vscode.Uri, pageNumber: number): Promise<string> {
			return textExtractor.getPageText(uri, pageNumber);
		},

		async getPageCount(uri: vscode.Uri): Promise<number> {
			const metadata = await textExtractor.getMetadata(uri);
			return metadata.pageCount;
		}
	};

	return api;
}

export function deactivate(): void {
	console.log('[PDF Preview] Extension deactivated');
}
