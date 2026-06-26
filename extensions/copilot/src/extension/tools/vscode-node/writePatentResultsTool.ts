/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { dirname } from '../../../util/vs/base/common/resources';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { assertFileOkForTool } from '../node/toolUtils';

interface IWritePatentResultsParams {
	filePath: string;
	content: string;
}

/**
 * Writes patent search results (or analysis) to a local file. Independent of the FlowLeap backend
 * and BYOK inference — it only touches the file system, so it works regardless of auth state.
 *
 * Reimplemented onto the platform abstractions (rather than the old fork's raw `fs`/`path`/`console`):
 * {@link IFileSystemService} for I/O (testable, cross-platform, web-capable) and {@link ILogService}
 * for tracing.
 */
class WritePatentResultsTool implements ICopilotTool<IWritePatentResultsParams> {

	public static readonly toolName = ToolName.WritePatentResults;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IWritePatentResultsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { filePath } = options.input;
		return {
			invocationMessage: l10n.t`Writing patent results to ${filePath}`,
			confirmationMessages: {
				title: l10n.t`Write Patent Results`,
				message: l10n.t`Allow Patent AI to write search results to ${filePath}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IWritePatentResultsParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[WritePatentResultsTool] Invoking write patent results');

		const { filePath, content } = options.input;

		// Resolve relative paths against the workspace (and reject invalid input) rather than
		// mapping them to the filesystem root via `URI.file`.
		const uri = this.promptPathRepresentationService.resolveFilePath(filePath);
		if (!uri) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: Invalid file path "${filePath}". Provide a valid absolute path within the workspace.`)
			]);
		}

		// Confine writes to the workspace before touching disk. Throws a clear "outside of the
		// workspace" error for out-of-workspace paths, which propagates as the tool error.
		await this.instantiationService.invokeFunction(accessor => assertFileOkForTool(accessor, uri));

		try {
			// Ensure the parent directory exists before writing.
			await createDirectoryIfNotExists(this.fileSystemService, dirname(uri));

			await this.fileSystemService.writeFile(uri, new TextEncoder().encode(content));

			this.logService.info(`[WritePatentResultsTool] Successfully wrote file: ${filePath}`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Successfully wrote patent results to ${filePath}`)
			]);

		} catch (error) {
			this.logService.error(`[WritePatentResultsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}
}

ToolRegistry.registerTool(WritePatentResultsTool);
