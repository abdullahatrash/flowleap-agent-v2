/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IDiffEditorOptionsService, SESSIONS_DIFF_EDITOR_WORD_WRAP_SETTING, SESSIONS_EDITOR_WORD_WRAP_SETTING } from '../common/diffEditorOptionsService.js';
import { DiffEditorOptionsService } from './diffEditorOptionsService.js';
import { SessionsDiffEditorLayoutContribution } from './sessionsDiffEditorLayout.js';

registerSingleton(IDiffEditorOptionsService, DiffEditorOptionsService, InstantiationType.Delayed);
registerWorkbenchContribution2(SessionsDiffEditorLayoutContribution.ID, SessionsDiffEditorLayoutContribution, WorkbenchPhase.AfterRestored);

export const sessionsEditorWordWrapConfiguration = {
	id: 'sessions',
	properties: {
		[SESSIONS_DIFF_EDITOR_WORD_WRAP_SETTING]: {
			type: 'string',
			enum: ['off', 'on', 'inherit'],
			default: 'inherit',
			scope: ConfigurationScope.APPLICATION,
			tags: ['preview'],
			markdownEnumDescriptions: [
				localize('sessions.diffEditor.wordWrap.off', "Lines will never wrap."),
				localize('sessions.diffEditor.wordWrap.on', "Lines will wrap at the viewport width."),
				localize('sessions.diffEditor.wordWrap.inherit', "Lines will wrap according to the {0} setting.", '`#editor.wordWrap#`'),
			],
			description: localize('sessions.diffEditor.wordWrap', "Controls how diff editors in the Agents window wrap lines."),
		},
		[SESSIONS_EDITOR_WORD_WRAP_SETTING]: {
			type: 'string',
			enum: ['off', 'on', 'inherit'],
			default: 'inherit',
			scope: ConfigurationScope.APPLICATION,
			tags: ['preview'],
			markdownEnumDescriptions: [
				localize('sessions.editor.wordWrap.off', "Lines will never wrap."),
				localize('sessions.editor.wordWrap.on', "Lines will wrap at the viewport width."),
				localize('sessions.editor.wordWrap.inherit', "Lines will wrap according to the {0} setting.", '`#editor.wordWrap#`'),
			],
			description: localize('sessions.editor.wordWrap', "Controls how code editors in the Agents window wrap lines."),
		},
	},
} satisfies IConfigurationNode;

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(sessionsEditorWordWrapConfiguration);
