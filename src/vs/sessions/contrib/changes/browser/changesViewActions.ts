/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, IAction2Options, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';
import { ISessionsService } from '../../../services/sessions/browser/sessionsService.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { bindContextKey } from '../../../../platform/observable/common/platformObservableUtils.js';
import { ActiveSessionContextKeys, CHANGES_VIEW_ID, ChangesContextKeys, SESSIONS_CHANGES_OPEN_SINGLE_FILE_DIFF_SETTING } from '../common/changes.js';
import { ActiveEditorContext, IsSessionsWindowContext, TextCompareEditorActiveContext } from '../../../../workbench/common/contextkeys.js';
import { URI } from '../../../../base/common/uri.js';
import { isEqual } from '../../../../base/common/resources.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { IChangesViewService } from '../common/changesViewService.js';
import { isCodeEditor, isDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { DiffEditorViewMode } from '../../../../editor/common/config/editorOptions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorCommandsContext } from '../../../../workbench/common/editor.js';
import { readTransientState, writeTransientState } from '../../../../workbench/contrib/codeEditor/browser/toggleWordWrap.js';
import { TEXT_FILE_EDITOR_ID } from '../../../../workbench/contrib/files/common/files.js';
import { MultiDiffEditor } from '../../../../workbench/contrib/multiDiffEditor/browser/multiDiffEditor.js';
import { IEditorGroupsService } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { Menus } from '../../../browser/menus.js';
import { IDiffEditorOptionsService, SESSIONS_DIFF_EDITOR_WORD_WRAP_SETTING, SESSIONS_EDITOR_WORD_WRAP_SETTING, SessionsDiffViewModeContext, SessionsWordWrap } from '../../editor/common/diffEditorOptionsService.js';

const openChangesViewActionOptions: IAction2Options = {
	id: 'workbench.action.agentSessions.openChangesView',
	title: localize2('openChangesView', "Changes"),
	icon: Codicon.diffMultiple,
	f1: false,
};

class OpenChangesViewAction extends Action2 {

	static readonly ID = openChangesViewActionOptions.id;

	constructor() {
		super(openChangesViewActionOptions);
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		await viewsService.openView(CHANGES_VIEW_ID, true);
	}
}

registerAction2(OpenChangesViewAction);

class ChangesViewActionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.changesViewActions';

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ISessionsService sessionsService: ISessionsService,
	) {
		super();

		// Bind context key: true when the active session has changes
		this._register(bindContextKey(ActiveSessionContextKeys.HasChanges, contextKeyService, reader => {
			const activeSession = sessionsService.activeSession.read(reader);
			if (!activeSession) {
				return false;
			}
			const changes = activeSession.changes.read(reader);
			return changes.length > 0;
		}));
	}
}

registerWorkbenchContribution2(ChangesViewActionsContribution.ID, ChangesViewActionsContribution, WorkbenchPhase.AfterRestored);

class OpenChangesAction extends Action2 {
	static readonly ID = 'workbench.action.agentSessions.openChanges';

	constructor() {
		super({
			id: OpenChangesAction.ID,
			title: localize2('openChanges', "Open Changes"),
			icon: Codicon.gitCompare,
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, _sessionResource: URI, _ref: string, ...resources: URI[]): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const changesViewService = accessor.get(IChangesViewService);

		const sessionChanges = changesViewService.activeSessionChangesObs.get();

		const changes = sessionChanges?.filter(change =>
			resources.some(resource => isEqual(change.modifiedUri ?? change.originalUri, resource))
		) ?? [];

		await Promise.all(changes.map(change => editorService.openEditor({
			original: { resource: change.originalUri },
			modified: { resource: change.modifiedUri }
		})));
	}
}

registerAction2(OpenChangesAction);

const agentsTextDiffEditorActive = ContextKeyExpr.and(
	IsSessionsWindowContext,
	TextCompareEditorActiveContext
);

const agentsMultiDiffEditorActive = ContextKeyExpr.and(
	IsSessionsWindowContext,
	ActiveEditorContext.isEqualTo(MultiDiffEditor.ID)
);

const agentsTextEditorActive = ContextKeyExpr.and(
	IsSessionsWindowContext,
	ActiveEditorContext.isEqualTo(TEXT_FILE_EDITOR_ID)
);

const agentsDiffEditorActive = ContextKeyExpr.or(
	agentsTextDiffEditorActive,
	agentsMultiDiffEditorActive
);

function wordWrapToggled(settingId: string) {
	return ContextKeyExpr.or(
		ContextKeyExpr.equals(`config.${settingId}`, 'on'),
		ContextKeyExpr.and(
			ContextKeyExpr.equals(`config.${settingId}`, 'inherit'),
			ContextKeyExpr.notEquals('config.editor.wordWrap', 'off'),
		),
	);
}

class ToggleSessionsEditorWordWrapAction extends Action2 {
	static readonly ID = 'workbench.action.agentSessions.toggleEditorWordWrap';

	constructor() {
		super({
			id: ToggleSessionsEditorWordWrapAction.ID,
			title: localize2('agentSessions.editorWordWrap', "Word Wrap"),
			f1: false,
			menu: [{
				id: MenuId.EditorTitle,
				group: '1_diff',
				order: 20,
				when: agentsTextEditorActive,
			}],
			toggled: wordWrapToggled(SESSIONS_EDITOR_WORD_WRAP_SETTING),
		});
	}

	async run(accessor: ServicesAccessor, context?: IEditorCommandsContext): Promise<void> {
		await toggleSessionsWordWrap(accessor, 'editor', context);
	}
}

class ToggleSessionsDiffEditorWordWrapAction extends Action2 {
	static readonly ID = 'workbench.action.agentSessions.toggleDiffEditorWordWrap';

	constructor() {
		super({
			id: ToggleSessionsDiffEditorWordWrapAction.ID,
			title: localize2('agentSessions.diffEditorWordWrap', "Word Wrap"),
			f1: false,
			menu: [{
				id: MenuId.EditorTitle,
				group: '1_diff',
				order: 20,
				when: agentsDiffEditorActive,
			}],
			toggled: wordWrapToggled(SESSIONS_DIFF_EDITOR_WORD_WRAP_SETTING),
		});
	}

	async run(accessor: ServicesAccessor, context?: IEditorCommandsContext): Promise<void> {
		await toggleSessionsWordWrap(accessor, 'diffEditor', context);
	}
}

async function toggleSessionsWordWrap(accessor: ServicesAccessor, target: 'editor' | 'diffEditor', context?: IEditorCommandsContext): Promise<void> {
	const codeEditorService = accessor.get(ICodeEditorService);
	const optionsService = accessor.get(IDiffEditorOptionsService);
	const editorService = accessor.get(IEditorService);
	const activeEditorPane = context
		? accessor.get(IEditorGroupsService).getGroup(context.groupId)?.activeEditorPane
		: editorService.activeEditorPane;
	const activeControl = activeEditorPane?.getControl();
	const diffEditor = target === 'diffEditor' && isDiffEditor(activeControl) ? activeControl : null;
	const codeEditor = target === 'editor' && isCodeEditor(activeControl)
		? activeControl
		: diffEditor?.getModifiedEditor() ?? null;
	const wordWrap = target === 'editor' ? optionsService.editorWordWrap.get() : optionsService.diffEditorWordWrap.get();
	const inheritedWordWrap = accessor.get(IConfigurationService).getValue<'off' | 'on' | 'wordWrapColumn' | 'bounded'>('editor.wordWrap');
	const isWordWrapEnabled = wordWrap === 'on' || wordWrap === 'inherit' && inheritedWordWrap !== 'off';
	const editors = codeEditor
		? diffEditor
			? [diffEditor.getOriginalEditor(), diffEditor.getModifiedEditor()]
			: [codeEditor]
		: [];
	const nextWordWrap: SessionsWordWrap = isWordWrapEnabled ? 'off' : 'on';
	if (target === 'editor') {
		await optionsService.setEditorWordWrap(nextWordWrap);
	} else {
		await optionsService.setDiffEditorWordWrap(nextWordWrap);
	}

	// A per-model word wrap override taken with the core "View: Toggle Word Wrap"
	// command would otherwise win over the window preference just set.
	let didClearTransientState = false;
	for (const editor of editors) {
		const model = editor.getModel();
		if (model && readTransientState(model, codeEditorService)) {
			writeTransientState(model, null, codeEditorService);
			didClearTransientState = true;
		}
	}
	if (didClearTransientState) {
		diffEditor?.updateOptions({});
	}
}

registerAction2(ToggleSessionsEditorWordWrapAction);
registerAction2(ToggleSessionsDiffEditorWordWrapAction);

// The "Diff View" submenu drives the preferred layout shared by the diff and the
// multi-diff editors of this window (see `IDiffEditorOptionsService`), so reviewing a
// session's changes never writes the user's global `diffEditor.renderSideBySide`
// setting. The workbench's own "Inline View" entry is hidden here (see
// `workbench/browser/parts/editor/editor.contribution.ts`).
const diffViewModes: readonly { readonly mode: DiffEditorViewMode; readonly id: string; readonly title: string; readonly order: number }[] = [
	{ mode: 'inline', id: 'workbench.action.agentSessions.setDiffViewMode.inline', title: localize('diffView.inline', "Inline"), order: 1 },
	{ mode: 'sideBySide', id: 'workbench.action.agentSessions.setDiffViewMode.sideBySide', title: localize('diffView.sideBySide', "Side by Side"), order: 2 },
	{ mode: 'automatic', id: 'workbench.action.agentSessions.setDiffViewMode.automatic', title: localize('diffView.automatic', "Automatic"), order: 3 },
];

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	submenu: Menus.SessionsDiffEditorView,
	title: localize('diffView', "Diff View"),
	group: '1_diff',
	order: 10,
	when: agentsDiffEditorActive,
});

for (const { mode, id, title, order } of diffViewModes) {
	registerAction2(class extends Action2 {
		constructor() {
			super({ id, title, f1: false });
		}

		run(accessor: ServicesAccessor): void {
			accessor.get(IDiffEditorOptionsService).setViewMode(mode);
		}
	});

	MenuRegistry.appendMenuItem(Menus.SessionsDiffEditorView, {
		command: {
			id,
			title,
			toggled: SessionsDiffViewModeContext.isEqualTo(mode),
		},
		group: '1_view',
		order,
	});
}

const openSingleFileDiffEnabled = ContextKeyExpr.equals(`config.${SESSIONS_CHANGES_OPEN_SINGLE_FILE_DIFF_SETTING}`, true);

class OpenFileAction extends Action2 {
	static readonly ID = 'workbench.action.agentSessions.openFile';

	constructor() {
		super({
			id: OpenFileAction.ID,
			title: localize2('openFile', "Open File"),
			icon: Codicon.goToFile,
			f1: false,
			menu: [
				// When opening a file already shows a single file diff, the "Open
				// Changes" alt action is redundant and is therefore omitted.
				{
					id: MenuId.AgentsChangeInlineToolbar,
					group: 'navigation',
					order: 1,
					when: ContextKeyExpr.and(
						IsSessionsWindowContext,
						ChangesContextKeys.ChangeKind.isEqualTo('file'),
						openSingleFileDiffEnabled)
				},
				// Default behavior: the alt action ("Open Changes") opens a diff
				// editor for the selected change(s).
				{
					id: MenuId.AgentsChangeInlineToolbar,
					group: 'navigation',
					order: 1,
					alt: {
						id: OpenChangesAction.ID,
						title: localize2('openChanges', "Open Changes"),
						icon: Codicon.gitCompare,
					},
					when: ContextKeyExpr.and(
						IsSessionsWindowContext,
						ChangesContextKeys.ChangeKind.isEqualTo('file'),
						openSingleFileDiffEnabled.negate())
				}
			]
		});
	}

	async run(accessor: ServicesAccessor, _sessionResource: URI, _ref: string, ...resources: URI[]): Promise<void> {
		const editorService = accessor.get(IEditorService);
		await Promise.all(resources.map(resource => editorService.openEditor({ resource })));
	}
}

registerAction2(OpenFileAction);


