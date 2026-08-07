/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Repeat-policy gate runner (#184).
 *
 * Runs one promptfoo suite N times and folds the runs into a single k-of-n verdict per case
 * (see `aggregate-repeats.ts` for the policy and the VOID rules). Then, if any case is short
 * of valid samples because a sample was voided, it re-draws just those cases — so judge or
 * transport flake shrinks the run, never the verdict.
 *
 * Why N invocations instead of one `--repeat N`: promptfoo's `--repeat` expands each case into
 * N independent rows inside ONE run and has no k-of-n aggregation of its own, so the policy is
 * ours to compute either way. Separate invocations additionally (a) let a deficient case be
 * topped up on its own with `--filter-pattern`, which `--repeat` cannot do without re-running
 * the whole suite, (b) keep the earlier runs' JSON when a later run dies, and (c) reproduce
 * how the flake was measured in #183 — whole-suite draws.
 *
 * `--no-cache` is always passed. Our providers bypass promptfoo's cache, but GRADER calls do
 * not, and promptfoo namespaces its cache per repeat index — without `--no-cache` a repeated
 * grading replays instead of re-sampling, which would make the extra runs worthless.
 *
 * Run: OPENROUTER_API_KEY=sk-... npx tsx evals/scripts/repeat-gate.ts \
 *        --config promptfooconfig.trajectory.yaml --baseline output/trajectory-baseline.json
 *      (or `npm run eval:trajectory:repeat` / `npm run eval:key-gate:repeat`)
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AggregateResult, DEFAULT_POLICY, RepeatBaseline, RepeatPolicy, aggregateRuns, deficientCases, formatTable, readBaseline, readRun } from './aggregate-repeats';

const EVALS_DIR = path.dirname(__dirname);
const LAUNCHER = path.join(EVALS_DIR, 'scripts', 'promptfoo.ts');

interface Options {
	readonly config: string;
	readonly runs: number;
	readonly baselinePath?: string;
	/** How many extra whole-suite-filtered rounds may be spent re-drawing voided samples. */
	readonly topUpRounds: number;
	readonly outputPrefix: string;
	readonly passthrough: readonly string[];
}

function parseArgs(argv: readonly string[]): Options {
	let config = 'promptfooconfig.trajectory.yaml';
	let runs = DEFAULT_POLICY.runs;
	let baselinePath: string | undefined;
	let topUpRounds = 1;
	let outputPrefix = '';
	const passthrough: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--config' || arg === '-c') { config = argv[++i]; }
		else if (arg === '--runs' || arg === '-n') { runs = Number(argv[++i]); }
		else if (arg === '--baseline') { baselinePath = argv[++i]; }
		else if (arg === '--top-up-rounds') { topUpRounds = Number(argv[++i]); }
		else if (arg === '--output-prefix') { outputPrefix = argv[++i]; }
		else if (arg === '--') { passthrough.push(...argv.slice(i + 1)); break; }
		else { passthrough.push(arg); }
	}

	if (!Number.isSafeInteger(runs) || runs < 1) {
		throw new Error(`--runs must be a positive integer, got ${runs}`);
	}
	if (!outputPrefix) {
		outputPrefix = path.basename(config).replace(/^promptfooconfig\./, '').replace(/\.yaml$/, '');
	}
	return { config, runs, baselinePath, topUpRounds, outputPrefix, passthrough };
}

/** One promptfoo invocation through the pinned launcher. Returns the output file it wrote. */
function runSuite(options: Options, outputPath: string, filterPattern?: string): string | undefined {
	const args = [
		LAUNCHER, 'eval',
		'-c', options.config,
		'-o', outputPath,
		'--no-cache',
		'--no-table',
		'--no-progress-bar',
		...(filterPattern ? ['--filter-pattern', filterPattern] : []),
		...options.passthrough
	];
	// promptfoo exits non-zero when tests fail — that is expected input here, not a runner error.
	spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', cwd: EVALS_DIR });
	const absolute = path.isAbsolute(outputPath) ? outputPath : path.join(EVALS_DIR, outputPath);
	return fs.existsSync(absolute) ? absolute : undefined;
}

/** Anchored alternation over the exact descriptions promptfoo should re-run. */
export function filterPatternFor(descriptions: readonly string[]): string {
	const escaped = descriptions.map(d => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return `^(?:${escaped.join('|')})$`;
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));
	const baseline: RepeatBaseline | undefined = options.baselinePath ? readBaseline(path.join(EVALS_DIR, options.baselinePath)) : undefined;
	const policy: RepeatPolicy = baseline?.policy ?? { ...DEFAULT_POLICY, runs: options.runs };
	const runCount = baseline ? policy.runs : options.runs;

	const runFiles: string[] = [];
	for (let i = 1; i <= runCount; i++) {
		console.log(`\n=== ${options.outputPrefix}: run ${i}/${runCount} ===`);
		const written = runSuite(options, `output/${options.outputPrefix}-repeat-${i}.json`);
		if (written) {
			runFiles.push(written);
		} else {
			console.error(`  run ${i} produced no output file — it contributes no samples`);
		}
	}

	if (runFiles.length === 0) {
		console.error('repeat-gate: no run produced results');
		process.exit(3);
	}

	let result: AggregateResult = aggregateRuns(runFiles.map(readRun), policy, baseline);

	for (let round = 1; round <= options.topUpRounds; round++) {
		const deficient = deficientCases(result);
		if (deficient.length === 0) {
			break;
		}
		console.log(`\n=== ${options.outputPrefix}: top-up round ${round} — re-drawing ${deficient.map(c => c.caseId).join(', ')} (voided samples) ===`);
		const written = runSuite(options, `output/${options.outputPrefix}-topup-${round}.json`, filterPatternFor(deficient.map(c => c.description)));
		if (!written) {
			break;
		}
		runFiles.push(written);
		result = aggregateRuns(runFiles.map(readRun), policy, baseline);
	}

	console.log('');
	console.log(formatTable(result, options.outputPrefix));
	if (baseline) {
		console.log(`  baseline: ${options.baselinePath} (updated ${baseline.updated})`);
	}
	console.log('');

	if (result.exitCode === 1) {
		console.error('repeat-gate: REGRESSION — a case fell below the pass threshold on valid samples.');
	} else if (result.exitCode === 2) {
		console.error('repeat-gate: INCONCLUSIVE — a case had too few valid samples to judge (judge or provider flake, NOT a model failure). Re-run.');
	} else {
		console.log('repeat-gate: OK — every case met the threshold.');
	}
	process.exit(result.exitCode);
}

if (typeof require !== 'undefined' && require.main === module) {
	main();
}
