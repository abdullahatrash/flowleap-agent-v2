/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Subset of the `flowleap.pdf-preview` extension API that the tools consume. The extension owns the
 * `pdfjs-dist` dependency and exposes text extraction so the tools never bundle a PDF parser.
 */
export interface PdfPreviewAPI {
	extractText(uri: vscode.Uri): Promise<string>;
	extractTextFromPages(uri: vscode.Uri, startPage: number, endPage: number): Promise<string>;
	getMetadata(uri: vscode.Uri): Promise<PdfMetadata>;
	getPageText(uri: vscode.Uri, pageNumber: number): Promise<string>;
	getPageCount(uri: vscode.Uri): Promise<number>;
}

/** The metadata the `flowleap.pdf-preview` extension reads from a PDF. */
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

/** Extension ID providing the {@link PdfPreviewAPI} (the FlowLeap PDF Preview built-in extension). */
const PDF_PREVIEW_EXTENSION_ID = 'flowleap.pdf-preview';

/** Activates the FlowLeap PDF Preview extension when needed and returns its API. */
export async function getPdfPreviewApi(): Promise<PdfPreviewAPI> {
	const pdfExtension = vscode.extensions.getExtension<PdfPreviewAPI>(PDF_PREVIEW_EXTENSION_ID);
	if (!pdfExtension) {
		throw new Error(`PDF Preview extension (${PDF_PREVIEW_EXTENSION_ID}) is not installed. Please ensure the PDF Preview extension is available.`);
	}
	if (!pdfExtension.isActive) {
		await pdfExtension.activate();
	}
	return pdfExtension.exports;
}

/** The text of a whole PDF, through the FlowLeap PDF Preview extension. */
export async function readPdfText(uri: vscode.Uri): Promise<string> {
	return (await getPdfPreviewApi()).extractText(uri);
}
