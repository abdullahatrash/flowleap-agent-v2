/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { currentAnswer, fillInventorAnswers, openInventorQuestions, parseInventorAnswers } from '../common/drafting/inventorAnswers';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DraftingWorkspace, textResult } from './draftingWorkspace';
import { buildInventorQuestionsDocx, readInventorQuestionsDocx } from './inventorQuestionsDocx';

interface IInventorQuestionsParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
	/** `send` writes the document for the inventor; `import` copies the inventor's answers back. */
	action: 'send' | 'import';
	/** For `import`: the answered file in the matter folder, `.docx` or `.md`; by default `inventor-questions.docx`. */
	file?: string;
}

/**
 * The Inventor Questions document of a matter (PRD 0025 S6). `send` writes
 * `inventor-questions.docx` from `inventor-answers.md`: one table with a row per open question and
 * an empty answer cell. `import` reads the answered `.docx` (or a `.md` in the format of
 * `inventor-answers.md`) and copies each answer into the empty current `**Answer:**` slot of its
 * question, never over a filled slot. Code copies the inventor's own words; the model applies them
 * to the draft after this, as before.
 */
export class InventorQuestionsTool implements ICopilotTool<IInventorQuestionsParams> {

	public static readonly toolName = ToolName.InventorQuestions;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IInventorQuestionsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { matter } = options.input;
		return options.input.action === 'import'
			? {
				invocationMessage: l10n.t`Copying the inventor's answers into the Inventor Questions of ${matter}`,
				confirmationMessages: {
					title: l10n.t`Import Inventor Answers`,
					message: l10n.t`Allow Patent AI to copy the inventor's answers into the empty answer slots of inventor-answers.md of ${matter}? Filled answers stay as they are.`,
				},
			}
			: {
				invocationMessage: l10n.t`Writing the Inventor Questions of ${matter} to Word`,
				confirmationMessages: {
					title: l10n.t`Send to Inventor`,
					message: l10n.t`Allow Patent AI to write inventor-questions.docx with the open Inventor Questions of ${matter}?`,
				},
			};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IInventorQuestionsParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const importing = options.input.action === 'import';
		const refused = importing ? 'No answer was copied.' : 'The Inventor Questions document was not written.';
		const workspace = await DraftingWorkspace.locate(options.input.matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const answers = await workspace.read(workspace.folder.inventorAnswers);
		if (answers === undefined) {
			return workspace.refusal(refused, `${workspace.folder.inventorAnswers} does not exist: the save of a draft with Inventor Questions writes it.`);
		}
		return importing ? this.importAnswers(workspace, answers, options.input.file, refused) : this.send(workspace, answers, refused);
	}

	private async send(workspace: DraftingWorkspace, answers: string, refused: string): Promise<vscode.LanguageModelToolResult> {
		const { folder } = workspace;
		const open = openInventorQuestions(answers);
		if (!open.length) {
			return textResult(`${refused} No Inventor Question in ${folder.inventorAnswers} has an empty answer: there is nothing to send. ${await workspace.checklistLine(false)}`);
		}
		const pending = await this.notImported(workspace, answers, folder.inventorQuestionsDocx);
		if (pending.length) {
			return workspace.refusal(refused, `${folder.inventorQuestionsDocx} has answers that are not in ${folder.inventorAnswers} yet (${pending.join(', ')}). Import them first (action "import"), so that a new document does not replace them.`);
		}
		await workspace.write(folder.inventorQuestionsDocx, await buildInventorQuestionsDocx(folder.matter, open));
		return textResult(`Wrote ${folder.inventorQuestionsDocx}: a table of ${open.length} open Inventor Question(s) (${open.map(question => question.id).join(', ')}), each with an empty answer cell. The attorney sends the file to the inventor. The inventor writes each answer in the "Your answer" column and sends the file back; the attorney puts it in ${folder.folder}/ and asks to apply the answers. ${await workspace.checklistLine(false)}`);
	}

	/** The question ids that an answered document at `path` would fill now: answers a new document would replace. */
	private async notImported(workspace: DraftingWorkspace, answers: string, path: string): Promise<readonly string[]> {
		const bytes = await workspace.readBytes(path);
		if (!bytes) {
			return [];
		}
		try {
			return fillInventorAnswers(answers, await readInventorQuestionsDocx(bytes)).filled;
		} catch {
			// Not a readable Word file: nothing to keep.
			return [];
		}
	}

	private async importAnswers(workspace: DraftingWorkspace, answers: string, file: string | undefined, refused: string): Promise<vscode.LanguageModelToolResult> {
		const { folder } = workspace;
		const path = file?.trim().replace(/\\/g, '/') || folder.inventorQuestionsDocx;
		const name = path.startsWith(`${folder.folder}/`) ? path.slice(folder.folder.length + 1) : '';
		if (!/^[^/]+\.(?:docx|md)$/i.test(name) || name.startsWith('.') || path === folder.inventorAnswers) {
			return workspace.refusal(refused, `"${path}" is not an answered file of the matter. Give a .docx or .md file in ${folder.folder}/ other than ${folder.inventorAnswers}, e.g. ${folder.inventorQuestionsDocx}.`);
		}
		const bytes = await workspace.readBytes(path);
		if (!bytes) {
			return workspace.refusal(refused, `${path} does not exist. The attorney puts the inventor's answered file in ${folder.folder}/.`);
		}
		let received: Map<string, string>;
		try {
			received = /\.docx$/i.test(path)
				? await readInventorQuestionsDocx(bytes)
				: new Map(parseInventorAnswers(new TextDecoder().decode(bytes)).map(section => [section.id, currentAnswer(section)]));
		} catch (error) {
			return workspace.refusal(refused, `${path} could not be read as a Word file: ${error instanceof Error ? error.message : String(error)}`);
		}
		const fill = fillInventorAnswers(answers, received);
		if (fill.filled.length) {
			await workspace.write(folder.inventorAnswers, fill.text);
		}
		const lines = [
			fill.filled.length
				? `Copied ${fill.filled.length} answer(s) from ${path} into ${folder.inventorAnswers}, in the inventor's words: ${fill.filled.join(', ')}.`
				: `No answer was copied from ${path}: it has no answer for a question with an empty answer in ${folder.inventorAnswers}.`,
			...(fill.kept.length ? [`Not changed, because their answer in ${folder.inventorAnswers} is filled already: ${fill.kept.join(', ')}.`] : []),
			...(fill.unknown.length ? [`Not copied, because ${folder.inventorAnswers} has no such question: ${fill.unknown.join(', ')}.`] : []),
			...(fill.filled.length ? [`Now apply the answers to the draft (application-drafting skill, Step 5).`] : []),
		];
		return textResult(`${lines.join(' ')} ${await workspace.checklistLine(false)}`);
	}
}

ToolRegistry.registerTool(InventorQuestionsTool);
