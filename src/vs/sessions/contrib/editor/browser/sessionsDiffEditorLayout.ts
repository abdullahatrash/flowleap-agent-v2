/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { isCodeEditor, isDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { TextDiffEditor } from '../../../../workbench/browser/parts/editor/textDiffEditor.js';
import { IWorkbenchContribution } from '../../../../workbench/common/contributions.js';
import { MultiDiffEditor } from '../../../../workbench/contrib/multiDiffEditor/browser/multiDiffEditor.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { IDiffEditorOptionsService } from '../common/diffEditorOptionsService.js';

/**
 * Applies the preferred diff layout and word wrap of the Agents window to the editors
 * that are currently open, whenever the preference or the visible editors change.
 */
export class SessionsDiffEditorLayoutContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sessions.diffEditorLayout';

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IDiffEditorOptionsService private readonly diffEditorOptionsService: IDiffEditorOptionsService,
	) {
		super();
		this._register(this.editorService.onDidActiveEditorChange(() => this.applyLayout()));
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.applyLayout()));
		this._register(autorun(reader => {
			this.diffEditorOptionsService.viewMode.read(reader);
			this.diffEditorOptionsService.diffEditorWordWrap.read(reader);
			this.applyDiffEditorLayout();
		}));
		this._register(autorun(reader => {
			this.diffEditorOptionsService.editorWordWrap.read(reader);
			this.applyCodeEditorWordWrap();
		}));
	}

	private applyLayout(): void {
		this.applyDiffEditorLayout();
		this.applyCodeEditorWordWrap();
	}

	private applyDiffEditorLayout(): void {
		const viewMode = this.diffEditorOptionsService.viewMode.get();
		const wordWrap = this.diffEditorOptionsService.diffEditorWordWrap.get();
		for (const pane of new Set([this.editorService.activeEditorPane, ...this.editorService.visibleEditorPanes])) {
			if (pane instanceof TextDiffEditor) {
				const control = pane.getControl();
				if (isDiffEditor(control)) {
					control.updateOptions({
						renderSideBySide: viewMode !== 'inline',
						useInlineViewWhenSpaceIsLimited: viewMode === 'automatic',
						diffWordWrap: wordWrap,
					});
				}
			} else if (pane instanceof MultiDiffEditor) {
				pane.setDiffEditorLayoutOptions(viewMode, wordWrap);
			}
		}
	}

	private applyCodeEditorWordWrap(): void {
		const wordWrap = this.diffEditorOptionsService.editorWordWrap.get();
		for (const pane of new Set([this.editorService.activeEditorPane, ...this.editorService.visibleEditorPanes])) {
			const control = pane?.getControl();
			if (isCodeEditor(control)) {
				control.updateOptions({ wordWrapOverride1: wordWrap });
			}
		}
	}
}
