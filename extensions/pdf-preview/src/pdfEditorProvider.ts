/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PdfTextExtractor } from './pdfTextExtractor';

/**
 * Custom editor provider for PDF files.
 * Uses PDF.js to render PDFs in a webview.
 */
export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider {
	public static readonly viewType = 'flowleap.pdfPreview';

	private readonly _webviews = new Map<string, vscode.WebviewPanel>();

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _textExtractor: PdfTextExtractor
	) { }

	public async openCustomDocument(
		uri: vscode.Uri,
		_openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken
	): Promise<vscode.CustomDocument> {
		return { uri, dispose: () => { } };
	}

	public async resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		this._webviews.set(document.uri.toString(), webviewPanel);

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._context.extensionUri, 'media'),
				vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', 'pdfjs-dist'),
			]
		};

		webviewPanel.webview.html = await this._getHtmlForWebview(webviewPanel.webview, document.uri);

		// Handle messages from the webview
		webviewPanel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'ready': {
					// Send the PDF data to the webview
					const pdfData = await this._getPdfData(document.uri);
					webviewPanel.webview.postMessage({
						type: 'loadPdf',
						data: pdfData
					});
					break;
				}

				case 'extractText':
					try {
						const text = await this._textExtractor.extractAllText(document.uri);
						// Open extracted text in a new document beside the PDF
						const doc = await vscode.workspace.openTextDocument({
							content: text,
							language: 'plaintext'
						});
						await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
						webviewPanel.webview.postMessage({
							type: 'textExtracted',
							text: text
						});
					} catch (err) {
						const errorMessage = err instanceof Error ? err.message : String(err);
						vscode.window.showErrorMessage(`Failed to extract text: ${errorMessage}`);
					}
					break;

				case 'extractTextOCR':
					try {
						webviewPanel.webview.postMessage({ type: 'ocrStarted' });
						await vscode.window.withProgress(
							{
								location: vscode.ProgressLocation.Notification,
								title: 'Extracting text with OCR (Mistral)...',
								cancellable: false,
							},
							async () => {
								const result = await this._textExtractor.extractWithOCR(document.uri);
								// Save markdown file next to the PDF with same name
								const pdfPath = document.uri.fsPath;
								const pdfDir = pdfPath.substring(0, pdfPath.lastIndexOf('/'));
								const mdPath = pdfPath.replace(/\.pdf$/i, '.md');
								const mdUri = vscode.Uri.file(mdPath);

								// Save images alongside the markdown
								if (result.images && result.images.length > 0) {
									for (const img of result.images) {
										const ext = img.mimeType.split('/')[1] || 'jpeg';
										const imgFilename = img.id.includes('.') ? img.id : `${img.id}.${ext}`;
										const imgPath = `${pdfDir}/${imgFilename}`;
										const imgUri = vscode.Uri.file(imgPath);
										const imgData = Buffer.from(img.base64, 'base64');
										await vscode.workspace.fs.writeFile(imgUri, imgData);
									}
									console.log(`[PDF Preview] Saved ${result.images.length} images`);
								}

								await vscode.workspace.fs.writeFile(mdUri, Buffer.from(result.markdown, 'utf-8'));
								// Open the saved file beside the PDF
								const extractedDoc = await vscode.workspace.openTextDocument(mdUri);
								await vscode.window.showTextDocument(extractedDoc, { viewColumn: vscode.ViewColumn.Beside });
								const imageMsg = result.images.length > 0 ? ` + ${result.images.length} images` : '';
								vscode.window.showInformationMessage(`OCR complete: ${mdPath.split('/').pop()}${imageMsg}`);
								webviewPanel.webview.postMessage({
									type: 'ocrComplete',
									text: result.markdown
								});
							}
						);
					} catch (err) {
						const errorMessage = err instanceof Error ? err.message : String(err);
						vscode.window.showErrorMessage(`OCR failed: ${errorMessage}`);
						webviewPanel.webview.postMessage({ type: 'ocrError', message: errorMessage });
					}
					break;

				case 'error':
					vscode.window.showErrorMessage(`PDF Error: ${message.message}`);
					break;

				case 'pageChanged':
					// Could update status bar or other UI
					break;
			}
		});

		webviewPanel.onDidDispose(() => {
			this._webviews.delete(document.uri.toString());
		});
	}

	/**
	 * Navigate to a specific page in the active PDF
	 */
	public goToPage(page: number): void {
		for (const webview of this._webviews.values()) {
			webview.webview.postMessage({
				type: 'goToPage',
				page: page
			});
		}
	}

	/**
	 * Zoom in or out
	 */
	public zoom(delta: number): void {
		for (const webview of this._webviews.values()) {
			webview.webview.postMessage({
				type: 'zoom',
				delta: delta
			});
		}
	}

	private async _getPdfData(uri: vscode.Uri): Promise<string> {
		const data = await vscode.workspace.fs.readFile(uri);
		// Convert to base64 for sending to webview
		return Buffer.from(data).toString('base64');
	}

	private async _getHtmlForWebview(webview: vscode.Webview, _uri: vscode.Uri): Promise<string> {
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media', 'pdfPreview.css')
		);

		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media', 'pdfPreview.js')
		);

		// PDF.js library
		const pdfJsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', 'pdfjs-dist', 'build', 'pdf.min.mjs')
		);

		const pdfWorkerUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
		);

		// Character maps and standard fonts are bundled from the pdfjs-dist package and
		// served through the webview asset scheme. The webview CSP blocks external hosts,
		// so a CDN cMapUrl would leave CJK (JP/CN/KR) patents blank — these must be local.
		const cMapUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', 'pdfjs-dist', 'cmaps')
		);

		const standardFontUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', 'pdfjs-dist', 'standard_fonts')
		);

		const nonce = this._getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; worker-src ${webview.cspSource} blob:; connect-src ${webview.cspSource};">
	<link href="${styleUri}" rel="stylesheet">
	<title>PDF Preview</title>
</head>
<body>
	<div id="toolbar">
		<div class="toolbar-group">
			<button id="prev-page" title="Previous Page">
				<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M10.5 3L5.5 8l5 5v-10z"/></svg>
			</button>
			<span id="page-info">
				<input type="number" id="page-input" min="1" value="1"> / <span id="page-count">0</span>
			</span>
			<button id="next-page" title="Next Page">
				<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M5.5 3l5 5-5 5V3z"/></svg>
			</button>
		</div>
		<div class="toolbar-group">
			<button id="zoom-out" title="Zoom Out">
				<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M3 7h10v2H3z"/></svg>
			</button>
			<span id="zoom-level">100%</span>
			<button id="zoom-in" title="Zoom In">
				<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M7 3v4H3v2h4v4h2V9h4V7H9V3z"/></svg>
			</button>
			<button id="zoom-fit" title="Fit to Width">Fit</button>
		</div>
		<div class="toolbar-group">
			<button id="find-toggle" title="Find in Document (${process.platform === 'darwin' ? '⌘F' : 'Ctrl+F'})">
				<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M11 6.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04-1.06 1.06-3.04-3.04z"/></svg>
				Find
			</button>
		</div>
		<div class="toolbar-group extract-group">
			<button id="extract-text" title="Quick Extract (PDF.js) - Free, local">
				<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M2 2h12v2H2zM2 5h12v2H2zM2 8h8v2H2zM2 11h10v2H2z"/></svg>
				Quick Extract
			</button>
			<button id="extract-ocr" title="OCR Extract (Mistral) - Better quality for scanned docs">
				<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M1 3v10h14V3H1zm1 1h12v8H2V4zm2 1v2h2V5H4zm3 0v2h5V5H7zM4 8v2h8V8H4z"/></svg>
				OCR Extract
			</button>
		</div>
	</div>
	<div id="find-bar" class="hidden" role="search">
		<input type="text" id="find-input" placeholder="Find" aria-label="Find in document" />
		<span id="find-count"></span>
		<button id="find-prev" title="Previous Match (Shift+Enter)">
			<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 5l5 5H3l5-5z"/></svg>
		</button>
		<button id="find-next" title="Next Match (Enter)">
			<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 11L3 6h10l-5 5z"/></svg>
		</button>
		<button id="find-close" title="Close (Escape)">
			<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 8.7l3.3 3.3.7-.7L8.7 8l3.3-3.3-.7-.7L8 7.3 4.7 4l-.7.7L7.3 8 4 11.3l.7.7L8 8.7z"/></svg>
		</button>
	</div>
	<div id="viewer-container">
		<div id="viewer"></div>
	</div>
	<div id="loading">
		<div class="spinner"></div>
		<span>Loading PDF...</span>
	</div>

	<script nonce="${nonce}">
		window.pdfJsUrl = "${pdfJsUri}";
		window.pdfWorkerUrl = "${pdfWorkerUri}";
		window.pdfCMapUrl = "${cMapUri}/";
		window.pdfStandardFontUrl = "${standardFontUri}/";
	</script>
	<script nonce="${nonce}" src="${scriptUri}" type="module"></script>
</body>
</html>`;
	}

	private _getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
