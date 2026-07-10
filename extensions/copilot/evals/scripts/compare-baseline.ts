/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Eval pass-rate baseline gate.
 *
 * Compares the latest promptfoo run (evals/output/latest.json) against the
 * committed baseline (evals/output/baseline.json) and fails when the pass rate
 * regresses beyond a small tolerance.
 *
 * Run standalone: cd <repo-root> && npx tsx evals/scripts/compare-baseline.ts
 *                 (or `npm run eval:check-baseline`)
 * Run via vitest:  npm run vitest -- evals/scripts/test/compareBaseline.spec.ts
 *
 * Re-baselining: after an INTENTIONAL prompt change, re-run the main suite,
 * update baseline.json from the green run, and commit it in its own commit.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Allowed pass-rate drop before the gate fails (2 percentage points). */
const TOLERANCE = 0.02;

interface BaselineFile {
	readonly updated: string;
	readonly config: string;
	readonly totalTests: number;
	readonly passing: number;
	readonly passRate: number;
	readonly notes?: string;
}

interface LatestResultsFile {
	readonly results: {
		readonly stats?: {
			readonly successes: number;
			readonly failures: number;
			readonly errors?: number;
		};
		readonly results?: ReadonlyArray<{ readonly success: boolean }>;
	};
}

export interface BaselineComparison {
	readonly currentRate: number;
	readonly baselineRate: number;
	readonly pass: boolean;
}

/**
 * Core comparator — exported so vitest can call it directly.
 *
 * @param latestPath   Path to a promptfoo output file (latest.json)
 * @param baselinePath Path to the committed baseline.json
 */
export function compareBaseline(latestPath: string, baselinePath: string): BaselineComparison {
	const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8')) as LatestResultsFile;
	const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8')) as BaselineFile;

	let total: number;
	let passing: number;
	const stats = latest.results?.stats;
	if (stats && typeof stats.successes === 'number' && typeof stats.failures === 'number') {
		passing = stats.successes;
		total = stats.successes + stats.failures + (stats.errors ?? 0);
	} else if (Array.isArray(latest.results?.results)) {
		const results = latest.results.results;
		total = results.length;
		passing = results.filter(r => r.success).length;
	} else {
		throw new Error(`compare-baseline: ${latestPath} has neither results.stats nor per-result success flags`);
	}

	if (total === 0) {
		throw new Error(`compare-baseline: ${latestPath} contains zero test results`);
	}

	const currentRate = passing / total;
	const baselineRate = baseline.passRate;
	const pass = currentRate >= baselineRate - TOLERANCE;

	return { currentRate, baselineRate, pass };
}

/** CLI entry point — only runs when executed directly (not when imported by vitest) */
function main(): void {
	// Resolve paths relative to current working directory (run from repo root)
	const root = process.cwd();
	const latestPath = path.join(root, 'evals/output/latest.json');
	const baselinePath = path.join(root, 'evals/output/baseline.json');

	const { currentRate, baselineRate, pass } = compareBaseline(latestPath, baselinePath);

	const fmt = (r: number) => `${(r * 100).toFixed(1)}%`;
	if (pass) {
		console.log(`compare-baseline: OK — current ${fmt(currentRate)} vs baseline ${fmt(baselineRate)} (tolerance ${fmt(TOLERANCE)})`);
		process.exit(0);
	}

	console.error('compare-baseline: REGRESSION DETECTED');
	console.error(`  current pass rate:  ${fmt(currentRate)}`);
	console.error(`  baseline pass rate: ${fmt(baselineRate)} (tolerance ${fmt(TOLERANCE)})`);
	console.error('  The eval suite regressed. Investigate output/latest.json before changing baseline.json —');
	console.error('  re-baseline only deliberately, in its own commit, after intentional prompt changes.');
	process.exit(1);
}

// Only run main() when invoked as a standalone script (not when imported by vitest)
if (typeof require !== 'undefined' && require.main === module) {
	main();
}
