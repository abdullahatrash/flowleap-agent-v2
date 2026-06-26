/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptElementProps, PromptReference } from '@vscode/prompt-tsx';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelPromptTsxPart, LanguageModelToolResult, MarkdownString } from '../../../vscodeTypes';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { renderPromptElementJSON } from '../../prompts/node/base/promptRenderer';
import { ToolName } from '../common/toolNames';
import { formatUriForFileWidget } from '../common/toolUtils';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { resolveToolInputPath } from '../node/toolUtils';

/**
 * Subset of the `flowleap.pdf-preview` extension API consumed here. The extension owns the
 * `pdfjs-dist` dependency and exposes text extraction so this tool never bundles a PDF parser.
 */
interface PdfPreviewAPI {
	extractText(uri: vscode.Uri): Promise<string>;
	extractTextFromPages(uri: vscode.Uri, startPage: number, endPage: number): Promise<string>;
	getMetadata(uri: vscode.Uri): Promise<PdfMetadata>;
	getPageText(uri: vscode.Uri, pageNumber: number): Promise<string>;
	getPageCount(uri: vscode.Uri): Promise<number>;
}

interface PdfMetadata {
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

export interface IReadPdfParams {
	filePath: string;
	startPage?: number;
	endPage?: number;
	pageNumber?: number;
}

/** Maximum characters to return (roughly 50 pages worth). */
const MAX_CHARS = 200000;

/** Extension ID providing the {@link PdfPreviewAPI} (the FlowLeap PDF Preview built-in extension). */
const PDF_PREVIEW_EXTENSION_ID = 'flowleap.pdf-preview';

/**
 * Tool for extracting text from local PDF files (patent PDFs, papers, technical docs). Delegates the
 * actual parsing to the `flowleap.pdf-preview` extension's exported API.
 */
export class ReadPdfTool implements ICopilotTool<IReadPdfParams> {
	public static readonly toolName = ToolName.ReadPdf;
	private _pdfApi: PdfPreviewAPI | null = null;

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	private async getPdfApi(): Promise<PdfPreviewAPI> {
		if (this._pdfApi) {
			return this._pdfApi;
		}

		const pdfExtension = vscode.extensions.getExtension<PdfPreviewAPI>(PDF_PREVIEW_EXTENSION_ID);
		if (!pdfExtension) {
			throw new Error(`PDF Preview extension (${PDF_PREVIEW_EXTENSION_ID}) is not installed. Please ensure the PDF Preview extension is available.`);
		}

		if (!pdfExtension.isActive) {
			await pdfExtension.activate();
		}

		this._pdfApi = pdfExtension.exports;
		return this._pdfApi;
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IReadPdfParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { input } = options;

		try {
			const uri = resolveToolInputPath(input.filePath, this.promptPathRepresentationService);

			// Verify it's a PDF file
			if (!uri.path.toLowerCase().endsWith('.pdf')) {
				throw new Error(`File is not a PDF: ${input.filePath}. Use read_file for non-PDF files.`);
			}

			const pdfApi = await this.getPdfApi();

			let metadata: PdfMetadata;
			try {
				metadata = await pdfApi.getMetadata(uri);
			} catch {
				metadata = { pageCount: 0, isEncrypted: false };
			}

			let text: string;
			let pagesRead: string;
			if (input.pageNumber !== undefined) {
				// Read a specific page
				text = await pdfApi.getPageText(uri, input.pageNumber);
				pagesRead = `page ${input.pageNumber}`;
			} else if (input.startPage !== undefined || input.endPage !== undefined) {
				// Read a page range
				const start = input.startPage ?? 1;
				const end = input.endPage ?? metadata.pageCount;
				text = await pdfApi.extractTextFromPages(uri, start, end);
				pagesRead = `pages ${start} to ${end}`;
			} else {
				// Read the entire document
				text = await pdfApi.extractText(uri);
				pagesRead = `all ${metadata.pageCount} pages`;
			}

			// Truncate if too long
			let truncated = false;
			if (text.length > MAX_CHARS) {
				text = text.substring(0, MAX_CHARS);
				truncated = true;
			}

			return new LanguageModelToolResult([
				new LanguageModelPromptTsxPart(
					await renderPromptElementJSON(
						this.instantiationService,
						ReadPdfResult,
						{ uri, text, metadata, pagesRead, truncated },
						options.tokenizationOptions ?? {
							tokenBudget: 8000,
							countTokens: t => Promise.resolve(t.length / 4)
						},
						token,
					),
				)
			]);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to read PDF: ${errorMessage}`);
		}
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IReadPdfParams>, _token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation | undefined> {
		const { input } = options;

		if (!input.filePath.length) {
			return;
		}

		const uri = resolveToolInputPath(input.filePath, this.promptPathRepresentationService);
		if (!uri.path.toLowerCase().endsWith('.pdf')) {
			throw new Error(`File is not a PDF: ${input.filePath}`);
		}

		let message: string;
		if (input.pageNumber !== undefined) {
			message = l10n.t`Reading page ${input.pageNumber} from ${formatUriForFileWidget(uri)}`;
		} else if (input.startPage !== undefined || input.endPage !== undefined) {
			message = l10n.t`Reading pages ${input.startPage ?? 1} to ${input.endPage ?? 'end'} from ${formatUriForFileWidget(uri)}`;
		} else {
			message = l10n.t`Reading PDF ${formatUriForFileWidget(uri)}`;
		}

		return {
			invocationMessage: new MarkdownString(message),
			pastTenseMessage: new MarkdownString(message.replace('Reading', 'Read')),
		};
	}

	async resolveInput(input: IReadPdfParams, _promptContext: IBuildPromptContext): Promise<IReadPdfParams> {
		return input;
	}
}

ToolRegistry.registerTool(ReadPdfTool);

interface ReadPdfResultProps extends BasePromptElementProps {
	uri: URI;
	text: string;
	metadata: PdfMetadata;
	pagesRead: string;
	truncated: boolean;
}

class ReadPdfResult extends PromptElement<ReadPdfResultProps> {
	constructor(
		props: PromptElementProps<ReadPdfResultProps>,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
	) {
		super(props);
	}

	override async render() {
		const { uri, text, metadata, pagesRead, truncated } = this.props;
		const filePath = this.promptPathRepresentationService.getFilePath(uri);

		if (text.trim().length === 0) {
			return <>(The PDF file `{filePath}` exists but contains no extractable text. It may be a scanned document or contain only images.)</>;
		}

		const metadataInfo: string[] = [];
		if (metadata.title) {
			metadataInfo.push(`Title: ${metadata.title}`);
		}
		if (metadata.author) {
			metadataInfo.push(`Author: ${metadata.author}`);
		}
		if (metadata.pageCount > 0) {
			metadataInfo.push(`Total pages: ${metadata.pageCount}`);
		}

		const header = metadataInfo.length > 0
			? `PDF: \`${filePath}\` (${pagesRead})\n${metadataInfo.join(' | ')}`
			: `PDF: \`${filePath}\` (${pagesRead})`;

		return <>
			{header}
			<br />
			<references value={[new PromptReference(uri, undefined, { isFromTool: true })]} />
			```
			{text}
			{truncated ? '\n\n[Content truncated. Use startPage/endPage parameters to read specific sections.]' : ''}
			```
		</>;
	}
}
