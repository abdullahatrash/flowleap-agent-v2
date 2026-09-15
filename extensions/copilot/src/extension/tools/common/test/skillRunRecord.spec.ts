/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { skillRunRecord } from '../skillRunRecord';
import { ToolName } from '../toolNames';

describe('skillRunRecord', () => {

	it('counts a bundled skill by id and every other skill as custom', () => {
		expect({
			bundled: skillRunRecord(ToolName.Skill, { skill: 'prior-art' }),
			cased: skillRunRecord(ToolName.Skill, { skill: 'Freedom-To-Operate' }),
			userNamed: skillRunRecord(ToolName.Skill, { skill: 'acme-v-widgetco-invalidity' }),
		}).toEqual({ bundled: 'prior-art', cased: 'freedom-to-operate', userNamed: 'custom' });
	});

	it('records nothing for another tool, or for a skill call with no usable name', () => {
		expect([
			skillRunRecord(ToolName.CoreRunInTerminal, { command: 'ls' }),
			skillRunRecord(ToolName.ReadFile, { skill: 'prior-art' }),
			skillRunRecord(ToolName.Skill, { skill: '   ' }),
			skillRunRecord(ToolName.Skill, { skill: 42 }),
			skillRunRecord(ToolName.Skill, undefined),
		]).toEqual([undefined, undefined, undefined, undefined, undefined]);
	});
});
