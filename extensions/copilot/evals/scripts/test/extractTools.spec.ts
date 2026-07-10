/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { buildToolDefinitions } from '../../prompts/extract-tools';

// vitest runs with cwd = repo root, so process.cwd() gives us the correct base.
const ROOT = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const allTools = pkg.contributes?.languageModelTools ?? [];

describe('extract-tools', () => {
	it('produces the migrated 20-tool patent surface plus referenced core/synthetic tools, with no copilot_ leakage', () => {
		const { definitions, missing } = buildToolDefinitions(allTools);

		expect(missing).toHaveLength(0);

		const names = definitions.map(d => d.function.name).sort();
		expect(names).toStrictEqual([
			'analyze_claim',
			'build_patent_query',
			'build_uspto_query',
			'citation_api_guide',
			'compare_claims',
			'create_file',
			'fetch_webpage',
			'get_patent_details',
			'get_patent_figures',
			'legal_search_guide',
			'ops_api_guide',
			'patent_analytics_viz',
			'patent_api_request',
			'patent_search_subagent',
			'read_pdf',
			'run_in_terminal',
			'search_academic',
			'search_citations',
			'search_forward_citations',
			'search_legal',
			'search_patents',
			'uspto_api_guide',
			'vscode_askQuestions',
			'web_search',
			'write_patent_results',
		]);

		const serialized = JSON.stringify(definitions);
		expect(serialized).not.toContain('copilot_');

		for (const def of definitions) {
			expect(def.type).toBe('function');
			expect(def.function.description.length).toBeGreaterThan(0);
			expect(def.function.parameters).toMatchObject({ type: 'object' });
		}
	});
});
