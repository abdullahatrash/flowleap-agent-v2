/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildSetupItems } from '../patentSetupView';

describe('buildSetupItems', () => {

	it('maps a fully-configured setup to four ok rows with the right click-through commands', () => {
		const items = buildSetupItems({ signedIn: true, accountLabel: 'jane@firm.co', byokModelCount: 3, epoConfigured: true, usptoConfigured: true });

		expect(items.map(i => ({ id: i.id, description: i.description, ok: i.ok, command: i.command?.command, args: i.command?.arguments }))).toEqual([
			{ id: 'account', description: 'jane@firm.co', ok: true, command: undefined, args: undefined },
			{ id: 'aiModel', description: '3 connected', ok: true, command: 'workbench.action.chat.manage', args: undefined },
			{ id: 'epo', description: 'Configured', ok: true, command: 'flowleap.patentDataKeys', args: ['epo'] },
			{ id: 'uspto', description: 'Configured', ok: true, command: 'flowleap.patentDataKeys', args: ['uspto'] },
		]);
	});

	it('maps a fresh install to actionable nudges (sign-in command only when signed out)', () => {
		const items = buildSetupItems({ signedIn: false, byokModelCount: 0, epoConfigured: false, usptoConfigured: false });

		expect(items.map(i => ({ id: i.id, description: i.description, ok: i.ok, command: i.command?.command }))).toEqual([
			{ id: 'account', description: 'Sign in…', ok: false, command: 'flowleap.signIn' },
			{ id: 'aiModel', description: 'Add your key…', ok: false, command: 'workbench.action.chat.manage' },
			{ id: 'epo', description: 'Add key…', ok: false, command: 'flowleap.patentDataKeys' },
			{ id: 'uspto', description: 'Add key…', ok: false, command: 'flowleap.patentDataKeys' },
		]);
	});
});
