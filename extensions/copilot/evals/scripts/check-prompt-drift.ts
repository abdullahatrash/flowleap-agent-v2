/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Heuristic prompt-drift checker.
 *
 * Compares patentAIPrompt.tsx and evals/prompts/system-prompt.txt to detect
 * load-bearing content drift: JSX tag names and patent tool name strings.
 *
 * Strategy:
 * - Tag names: extracted from `<Tag name='foo'>` in TSX; each must appear as `<foo>` in txt.
 * - Tool names: extracted from backtick-quoted identifiers in TSX that match known patent tools
 *   (i.e. snake_case names containing an underscore that appear literally in rendered prompt text).
 *   Using backtick literals is more reliable than ToolName enum refs because only actually-rendered
 *   tool names appear in backticks — conditional blocks that are never rendered never contribute.
 *
 * Run standalone: cd <repo-root> && npx tsx evals/scripts/check-prompt-drift.ts
 * Run via vitest:  npm run vitest -- evals/scripts/test/checkPromptDrift.spec.ts
 */

import * as fs from 'fs';
import * as path from 'path';

/** Extract Tag names from TSX source: <Tag name='foo'> */
function extractTagNames(tsxSource: string): string[] {
	const names: string[] = [];
	const re = /<Tag\s+name='([^']+)'/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(tsxSource)) !== null) {
		if (!names.includes(m[1])) {
			names.push(m[1]);
		}
	}
	return names;
}

/**
 * Extract backtick-quoted patent tool names from TSX source.
 * A "patent tool name" is a backtick literal that looks like a snake_case tool identifier
 * and starts with a known patent tool prefix.
 */
const PATENT_TOOL_PREFIXES = [
	'build_patent',
	'build_uspto',
	'search_patent',
	'search_academic',
	'search_citation',
	'search_forward',
	'search_legal',
	'write_patent',
	'ops_api',
	'uspto_api',
	'citation_api',
	'legal_search',
	'patent_api',
	'patent_search',
	'patent_analytics',
	'patstat_',
	'analyze_claim',
	'compare_claims',
	'compare_patents',
	'read_pdf',
	'get_patent',
	'get_legal',
	'get_register',
];

function extractPatentToolNames(tsxSource: string): string[] {
	const names: string[] = [];
	// Match backtick-quoted identifiers like `build_patent_query`
	const re = /`([a-z][a-z0-9_]+)`/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(tsxSource)) !== null) {
		const name = m[1];
		if (PATENT_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))) {
			if (!names.includes(name)) {
				names.push(name);
			}
		}
	}
	return names;
}

export interface DriftResult {
	readonly missingTags: readonly string[];
	readonly missingTools: readonly string[];
}

/**
 * Core comparator function — exported so vitest can call it directly.
 *
 * @param tsxPath  Path to patentAIPrompt.tsx
 * @param txtPath  Path to system-prompt.txt
 */
export function checkDrift(tsxPath: string, txtPath: string): DriftResult {
	const tsxSource = fs.readFileSync(tsxPath, 'utf-8');
	const txtContent = fs.readFileSync(txtPath, 'utf-8');

	// --- Tag names ---
	const tagNames = extractTagNames(tsxSource);
	const missingTags: string[] = [];
	for (const tag of tagNames) {
		// Tags appear as XML-ish markers: <tagName> in the rendered txt
		if (!txtContent.includes(`<${tag}>`)) {
			missingTags.push(`<${tag}>`);
		}
	}

	// --- Patent tool names (backtick literals in TSX) ---
	const toolNames = extractPatentToolNames(tsxSource);
	const missingTools: string[] = [];
	for (const tool of toolNames) {
		if (!txtContent.includes(tool)) {
			missingTools.push(tool);
		}
	}

	return { missingTags, missingTools };
}

/** CLI entry point — only runs when executed directly (not when imported by vitest) */
function main(): void {
	// Resolve paths relative to current working directory (run from repo root)
	const root = process.cwd();
	const tsxPath = path.join(root, 'src/extension/prompts/node/agent/patentAIPrompt.tsx');
	const txtPath = path.join(root, 'evals/prompts/system-prompt.txt');

	const { missingTags, missingTools } = checkDrift(tsxPath, txtPath);

	if (missingTags.length === 0 && missingTools.length === 0) {
		console.log('check-prompt-drift: OK — no drift detected');
		process.exit(0);
	}

	console.error('check-prompt-drift: DRIFT DETECTED');
	if (missingTags.length > 0) {
		console.error('Missing tag names in system-prompt.txt:');
		for (const t of missingTags) {
			console.error(`  ${t}`);
		}
	}
	if (missingTools.length > 0) {
		console.error('Missing tool names in system-prompt.txt:');
		for (const t of missingTools) {
			console.error(`  ${t}`);
		}
	}
	process.exit(1);
}

// Only run main() when invoked as a standalone script (not when imported by vitest)
if (typeof require !== 'undefined' && require.main === module) {
	main();
}
