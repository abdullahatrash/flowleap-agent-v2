/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { checkDrift } from '../check-prompt-drift';

// vitest runs with cwd = repo root, so process.cwd() gives us the correct base.
const ROOT = process.cwd();

const TSX_PATH = path.join(ROOT, 'src/extension/prompts/node/agent/patentAIPrompt.tsx');
const TXT_PATH = path.join(ROOT, 'evals/prompts/system-prompt.txt');

describe('check-prompt-drift', () => {
	it('system-prompt.txt contains all JSX tag names from patentAIPrompt.tsx', () => {
		const { missingTags } = checkDrift(TSX_PATH, TXT_PATH);
		expect(missingTags, `Missing tags: ${missingTags.join(', ')}`).toHaveLength(0);
	});

	it('system-prompt.txt contains all patent tool names from patentAIPrompt.tsx', () => {
		const { missingTools } = checkDrift(TSX_PATH, TXT_PATH);
		expect(missingTools, `Missing tools: ${missingTools.join(', ')}`).toHaveLength(0);
	});
});
