/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isValidBasename } from '../../../../../base/common/extpath.js';
import { extname } from '../../../../../base/common/path.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import * as nls from '../../../../../nls.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { SnippetsAction } from './abstractSnippetsActions.js';
import { Snippet, SnippetSource } from '../snippetsFile.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IUserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfile.js';
import { patentPromptCategories, PromptCategory, PromptTemplate } from '../../../../common/patent/patentPromptTemplates.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { SnippetController2 } from '../../../../../editor/contrib/snippet/browser/snippetController2.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';

interface ICategoryPick extends IQuickPickItem {
	category: PromptCategory;
}

interface ITemplatePick extends IQuickPickItem {
	template: PromptTemplate;
}

async function createSnippetFile(scope: string, defaultPath: URI, quickInputService: IQuickInputService, fileService: IFileService, textFileService: ITextFileService, opener: IOpenerService) {

	function createSnippetUri(input: string) {
		const filename = extname(input) !== '.code-snippets'
			? `${input}.code-snippets`
			: input;
		return joinPath(defaultPath, filename);
	}

	await fileService.createFolder(defaultPath);

	const input = await quickInputService.input({
		placeHolder: nls.localize('name', "Type template file name"),
		async validateInput(input) {
			if (!input) {
				return nls.localize('bad_name1', "Invalid file name");
			}
			if (!isValidBasename(input)) {
				return nls.localize('bad_name2', "'{0}' is not a valid file name", input);
			}
			if (await fileService.exists(createSnippetUri(input))) {
				return nls.localize('bad_name3', "'{0}' already exists", input);
			}
			return undefined;
		}
	});

	if (!input) {
		return undefined;
	}

	const resource = createSnippetUri(input);

	await textFileService.write(resource, [
		'{',
		'\t// Place your ' + scope + ' prompt templates here. Each template is defined under a name and has a scope, prefix, body and ',
		'\t// description. Add comma separated ids of the languages where the template is applicable in the scope field. If scope ',
		'\t// is left empty or omitted, the template gets applied to all languages. The prefix is what is ',
		'\t// used to trigger the template and the body will be expanded and inserted. Possible variables are: ',
		'\t// $1, $2 for tab stops, $0 for the final cursor position, and ${1:label}, ${2:another} for placeholders. ',
		'\t// Placeholders with the same ids are connected.',
		'\t// Example:',
		'\t// "Prior Art Search": {',
		'\t// \t"prefix": "search",',
		'\t// \t"body": [',
		'\t// \t\t"<task>Search for prior art related to $1</task>",',
		'\t// \t\t"$2"',
		'\t// \t],',
		'\t// \t"description": "Basic prior art search prompt"',
		'\t// }',
		'}'
	].join('\n'));

	await opener.open(resource);
	return undefined;
}

export class ConfigureSnippetsAction extends SnippetsAction {
	constructor() {
		super({
			id: 'workbench.action.openSnippets',
			title: nls.localize2('openSnippet.label', "Configure Prompt Templates"),
			shortTitle: {
				...nls.localize2('userSnippets', "Prompt Templates"),
				mnemonicTitle: nls.localize({ key: 'miOpenSnippets', comment: ['&& denotes a mnemonic'] }, "&&Prompt Templates"),
			},
			f1: true,
			menu: [
				{ id: MenuId.MenubarPreferencesMenu, group: '2_configuration', order: 5 },
				{ id: MenuId.GlobalActivity, group: '2_configuration', order: 5 },
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<any> {

		const quickInputService = accessor.get(IQuickInputService);
		const opener = accessor.get(IOpenerService);
		const userDataProfileService = accessor.get(IUserDataProfileService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const fileService = accessor.get(IFileService);
		const textFileService = accessor.get(ITextFileService);
		const editorService = accessor.get(IEditorService);

		// Build category picks
		const categoryPicks: QuickPickInput<ICategoryPick>[] = [
			{ type: 'separator', label: nls.localize('group.categories', "Patent Prompt Template Categories") }
		];

		for (const category of patentPromptCategories) {
			categoryPicks.push({
				label: `$(${category.icon.id}) ${category.label}`,
				description: category.description,
				category
			} satisfies ICategoryPick);
		}

		// Add custom template file options
		type SnippetPick = IQuickPickItem & { uri: URI } & { scope: string };
		const globalSnippetPicks: SnippetPick[] = [{
			scope: nls.localize('new.global_scope', 'global'),
			label: nls.localize('new.global', "New Global Prompt Template file..."),
			uri: userDataProfileService.currentProfile.snippetsHome
		}];

		const workspaceSnippetPicks: SnippetPick[] = [];
		for (const folder of workspaceService.getWorkspace().folders) {
			workspaceSnippetPicks.push({
				scope: nls.localize('new.workspace_scope', "{0} workspace", folder.name),
				label: nls.localize('new.folder', "New Prompt Template file for '{0}'...", folder.name),
				uri: folder.toResource('.vscode')
			});
		}

		const customPicks: QuickPickInput[] = [
			{ type: 'separator', label: nls.localize('new.global.sep', "Custom Templates") },
			...globalSnippetPicks,
			...workspaceSnippetPicks
		];

		const pick = await quickInputService.pick(
			([] as QuickPickInput[]).concat(categoryPicks, customPicks),
			{
				placeHolder: nls.localize('openSnippet.pickLanguage', "Select Prompt Template Category"),
				matchOnDescription: true
			}
		);

		if (!pick) {
			return;
		}

		// Handle custom template file creation
		if (globalSnippetPicks.indexOf(pick as SnippetPick) >= 0 || workspaceSnippetPicks.indexOf(pick as SnippetPick) >= 0) {
			return createSnippetFile((pick as SnippetPick).scope, (pick as SnippetPick).uri, quickInputService, fileService, textFileService, opener);
		}

		// Handle category selection — show templates within the category
		const categoryPick = pick as ICategoryPick;
		if (!categoryPick.category) {
			return;
		}

		const templatePicks: QuickPickInput<ITemplatePick>[] = categoryPick.category.templates.map(template => ({
			label: template.name,
			description: template.prefix,
			detail: template.description,
			template
		} satisfies ITemplatePick));

		const templateChoice = await quickInputService.pick(templatePicks, {
			placeHolder: nls.localize('pickTemplate', "Select a prompt template to insert"),
			matchOnDetail: true
		});

		if (!templateChoice || !(templateChoice as ITemplatePick).template) {
			return;
		}

		const template = (templateChoice as ITemplatePick).template;
		const snippetBody = template.body.join('\n');
		const snippetObj = new Snippet(
			false,
			[],
			template.name,
			template.prefix,
			template.description,
			snippetBody,
			'',
			SnippetSource.User,
			`patent-template/${template.prefix}`
		);

		// If no active text editor, open a new untitled editor first
		let codeEditor = editorService.activeTextEditorControl as ICodeEditor | undefined;
		if (!codeEditor || !SnippetController2.get(codeEditor)) {
			const input = await editorService.openEditor({ resource: undefined });
			codeEditor = input?.getControl() as ICodeEditor | undefined;
		}

		if (codeEditor) {
			codeEditor.focus();
			SnippetController2.get(codeEditor)?.insert(snippetObj.codeSnippet, {});
		}
	}
}
