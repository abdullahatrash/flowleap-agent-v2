/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getSessionWorkflowTemplates } from '../../common/sessionWorkflowTemplates.js';

suite('sessionWorkflowTemplates', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('templates seed a research-task-first prompt that invokes the bundled recipe skill', () => {
		const templates = getSessionWorkflowTemplates();

		assert.deepStrictEqual(templates.map(t => ({
			id: t.id,
			label: t.label,
			// The prompt must lead with the research task (it becomes the session
			// title), invoke the corresponding bundled recipe skill by name, and
			// leave a <…> token for the user's parameters.
			promptLead: t.prompt.split(':')[0],
			invokesSkill: t.prompt.includes(`recipe-${t.id}`),
			hasParameterToken: /<[^>]+>/.test(t.prompt),
		})), [
			{
				id: 'prior-art-search',
				label: 'Prior-Art Search',
				promptLead: 'Prior-art search',
				invokesSkill: true,
				hasParameterToken: true,
			},
			{
				id: 'freedom-to-operate',
				label: 'Freedom to Operate',
				promptLead: 'FTO analysis',
				invokesSkill: true,
				hasParameterToken: true,
			},
			{
				id: 'patent-landscape',
				label: 'Patent Landscape',
				promptLead: 'Patent landscape',
				invokesSkill: true,
				hasParameterToken: true,
			},
			{
				id: 'claim-analysis',
				label: 'Claim Analysis',
				promptLead: 'Claim analysis',
				invokesSkill: true,
				hasParameterToken: true,
			},
			{
				id: 'patent-to-report',
				label: 'Patent to Report',
				promptLead: 'Patent report',
				invokesSkill: true,
				hasParameterToken: true,
			},
			{
				id: 'academic-literature-review',
				label: 'Academic Literature Review',
				promptLead: 'Literature review',
				invokesSkill: true,
				hasParameterToken: true,
			},
		]);
	});
});
