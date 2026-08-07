/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Repeat-policy aggregator for the trajectory / key-gate suites (#184).
 *
 * A single promptfoo run is an n=1 draw from a noisy process: the trajectory gate flakes
 * ~15-25% per case run-to-run, so one red run proves nothing and an all-green run is not
 * reliably reachable. This turns N runs of the SAME suite into one statistical verdict per
 * case: pass when at least k of the VALID samples passed.
 *
 * A sample is VOID (excluded from the denominator, counted as neither pass nor fail) when the
 * row failed for a reason that is not model behaviour:
 *   - the judge could not be parsed — promptfoo tags that component `metadata.graderError`
 *     (also covers an empty judge response); grader flake must never fail a case.
 *   - the row is a promptfoo ERROR (`failureReason: 2` / an `error` field) — a transport or
 *     provider failure, e.g. the OpenRouter rate-limit-in-a-200 that `trajectory-provider.ts`
 *     now throws on.
 * A row that failed a structural assert is a real FAIL even when a judge component ALSO
 * grader-errored: the deterministic layer saw a genuine miss.
 *
 * Reads the same `outputPath` JSON as `compare-baseline.ts` (`results.results[]` with
 * `success` / `failureReason` / `gradingResult.componentResults[]`).
 *
 * Run standalone: npx tsx evals/scripts/aggregate-repeats.ts output/run-1.json output/run-2.json ...
 *                 (usually via scripts/repeat-gate.ts, which produces the run files first)
 */

import * as fs from 'fs';
import * as path from 'path';

/** promptfoo `ResultFailureReason.ERROR` — a transport/provider failure, not an assertion miss. */
const FAILURE_REASON_ERROR = 2;

/** How a single run of one case is classified. */
export type SampleKind = 'pass' | 'fail' | 'void-grader' | 'void-error';

/** k-of-n policy. The threshold is an exact fraction so no float rounding can shift `required`. */
export interface RepeatPolicy {
	/** How many runs of the suite make up one verdict. */
	readonly runs: number;
	/** Fraction of VALID samples that must pass, e.g. 2/3. */
	readonly passThreshold: { readonly numerator: number; readonly denominator: number };
	/** Fewest valid samples that can support a verdict; below this the case is INCONCLUSIVE. */
	readonly minValidSamples: number;
}

export const DEFAULT_POLICY: RepeatPolicy = {
	runs: 3,
	passThreshold: { numerator: 2, denominator: 3 },
	minValidSamples: 2
};

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface CaseVerdict {
	readonly caseId: string;
	readonly description: string;
	readonly samples: readonly SampleKind[];
	readonly passes: number;
	readonly fails: number;
	readonly voidedGrader: number;
	readonly voidedError: number;
	/** passes + fails — the denominator the threshold is applied to. */
	readonly valid: number;
	/** Passes needed for this case's valid-sample count. */
	readonly required: number;
	readonly verdict: Verdict;
	/** Set when a committed baseline is supplied. */
	readonly baselineExpected?: Verdict;
	readonly status?: 'ok' | 'regression' | 'improvement' | 'inconclusive' | 'new';
}

export interface AggregateResult {
	readonly policy: RepeatPolicy;
	readonly cases: readonly CaseVerdict[];
	readonly totalVoidedGrader: number;
	readonly totalVoidedError: number;
	/** 0 = all cases pass, 1 = a case failed, 2 = a case could not be judged. */
	readonly exitCode: 0 | 1 | 2;
}

/** The committed per-case expectation the aggregator gates against. */
export interface RepeatBaseline {
	readonly updated: string;
	readonly config: string;
	readonly policy: RepeatPolicy;
	readonly model?: string;
	readonly judge?: string;
	readonly notes?: string;
	readonly cases: Readonly<Record<string, { readonly expected: Verdict; readonly observed?: string; readonly note?: string }>>;
}

/** The slice of a promptfoo `outputPath` JSON this aggregator reads. */
export interface PromptfooRun {
	readonly results: {
		readonly results?: ReadonlyArray<{
			readonly success?: boolean;
			readonly failureReason?: number;
			readonly error?: string;
			readonly testCase?: { readonly description?: string; readonly vars?: Record<string, unknown> };
			readonly vars?: Record<string, unknown>;
			readonly gradingResult?: {
				readonly componentResults?: ReadonlyArray<{
					readonly pass?: boolean;
					readonly metadata?: { readonly graderError?: boolean };
				}>;
			};
		}>;
	};
}

type RunResult = NonNullable<NonNullable<PromptfooRun['results']['results']>[number]>;

/**
 * Short, stable key for a case — the leading `T3a` / `K1` token of its description, which is
 * what the datasets, the README table and the baseline all name it by.
 */
export function deriveCaseId(result: RunResult): string {
	const description = result.testCase?.description ?? '';
	const leading = /^([A-Z]\d+[a-z]?)\b/.exec(description);
	if (leading) {
		return leading[1];
	}
	const mockScript = (result.vars ?? result.testCase?.vars ?? {})['mockScript'];
	if (typeof mockScript === 'string' && mockScript.length > 0) {
		return mockScript;
	}
	return description || 'unknown';
}

/**
 * Classify one row. VOID beats FAIL only when EVERY failing component is a grader error —
 * a failing structural assert is model behaviour whatever the judge did.
 */
export function classifySample(result: RunResult): SampleKind {
	// `failureReason` is the ONLY reliable ERROR signal. A row's `error` field is also populated
	// with the assertion failure text on ordinary ASSERT failures ("Custom function returned
	// false", "Could not extract JSON from llm-rubric response"), so testing it would void every
	// failing case in the suite.
	if (result.failureReason === FAILURE_REASON_ERROR) {
		return 'void-error';
	}
	if (result.success === true) {
		return 'pass';
	}
	const failing = (result.gradingResult?.componentResults ?? []).filter(component => component.pass !== true);
	if (failing.length > 0 && failing.every(component => component.metadata?.graderError === true)) {
		return 'void-grader';
	}
	return 'fail';
}

/** Passes needed for `valid` samples under `policy`, by exact integer arithmetic. */
export function requiredPasses(valid: number, policy: RepeatPolicy): number {
	const { numerator, denominator } = policy.passThreshold;
	return Math.ceil((valid * numerator) / denominator);
}

type SampleCounts = Pick<CaseVerdict, 'passes' | 'fails' | 'voidedGrader' | 'voidedError' | 'valid' | 'required' | 'verdict'>;

function verdictFor(samples: readonly SampleKind[], policy: RepeatPolicy): SampleCounts {
	const passes = samples.filter(s => s === 'pass').length;
	const fails = samples.filter(s => s === 'fail').length;
	const voidedGrader = samples.filter(s => s === 'void-grader').length;
	const voidedError = samples.filter(s => s === 'void-error').length;
	const valid = passes + fails;
	const required = requiredPasses(valid, policy);
	const verdict: Verdict = valid < policy.minValidSamples ? 'INCONCLUSIVE' : (passes >= required ? 'PASS' : 'FAIL');
	return { passes, fails, voidedGrader, voidedError, valid, required, verdict };
}

/**
 * Fold N runs of the same suite into one verdict per case.
 *
 * @param runs     Parsed promptfoo output JSONs, one per run (order is preserved in `samples`).
 * @param policy   The k-of-n policy to apply.
 * @param baseline Optional committed expectations; when given, verdicts are compared against it.
 */
export function aggregateRuns(runs: readonly PromptfooRun[], policy: RepeatPolicy = DEFAULT_POLICY, baseline?: RepeatBaseline): AggregateResult {
	const samplesByCase = new Map<string, { description: string; samples: SampleKind[] }>();
	for (const run of runs) {
		for (const result of run.results?.results ?? []) {
			const caseId = deriveCaseId(result);
			let entry = samplesByCase.get(caseId);
			if (!entry) {
				entry = { description: result.testCase?.description ?? caseId, samples: [] };
				samplesByCase.set(caseId, entry);
			}
			entry.samples.push(classifySample(result));
		}
	}

	if (samplesByCase.size === 0) {
		throw new Error('aggregate-repeats: the run files contain zero test results');
	}

	const cases: CaseVerdict[] = [];
	for (const [caseId, entry] of samplesByCase) {
		const counts = verdictFor(entry.samples, policy);
		const baselineEntry = baseline?.cases[caseId];
		let status: CaseVerdict['status'];
		if (baseline) {
			if (!baselineEntry) {
				status = counts.verdict === 'PASS' ? 'new' : (counts.verdict === 'FAIL' ? 'regression' : 'inconclusive');
			} else if (counts.verdict === 'INCONCLUSIVE') {
				status = 'inconclusive';
			} else if (counts.verdict === baselineEntry.expected) {
				status = 'ok';
			} else {
				status = counts.verdict === 'PASS' ? 'improvement' : 'regression';
			}
		}
		cases.push({
			caseId,
			description: entry.description,
			samples: entry.samples,
			...counts,
			baselineExpected: baselineEntry?.expected,
			status
		});
	}
	// Numeric collation so T10 sorts after T2, not after T1.
	cases.sort((a, b) => a.caseId.localeCompare(b.caseId, 'en', { numeric: true }));

	// A case the baseline expects to fail is not a red gate; a NEW case must pass.
	const failed = cases.some(c => (baseline ? c.status === 'regression' : c.verdict === 'FAIL'));
	const inconclusive = cases.some(c => c.verdict === 'INCONCLUSIVE');
	const exitCode: 0 | 1 | 2 = failed ? 1 : (inconclusive ? 2 : 0);

	return {
		policy,
		cases,
		totalVoidedGrader: cases.reduce((sum, c) => sum + c.voidedGrader, 0),
		totalVoidedError: cases.reduce((sum, c) => sum + c.voidedError, 0),
		exitCode
	};
}

/** Cases that still need samples to reach `policy.runs` valid ones — the top-up work list. */
export function deficientCases(result: AggregateResult): readonly CaseVerdict[] {
	return result.cases.filter(c => c.valid < result.policy.runs);
}

const SAMPLE_GLYPH: Record<SampleKind, string> = {
	'pass': 'P',
	'fail': 'F',
	'void-grader': 'g',
	'void-error': 'e'
};

/** One table, readable in a terminal and in a PR body. */
export function formatTable(result: AggregateResult, title: string): string {
	const { numerator, denominator } = result.policy.passThreshold;
	const lines: string[] = [];
	lines.push(`${title} — pass ${numerator}/${denominator} of valid samples over ${result.policy.runs} runs (min ${result.policy.minValidSamples} valid)`);
	lines.push('');

	const withBaseline = result.cases.some(c => c.baselineExpected !== undefined);
	const voidCell = (c: CaseVerdict) => c.voidedGrader + c.voidedError === 0
		? '0'
		: `${c.voidedGrader + c.voidedError}${c.voidedGrader > 0 ? 'g' : ''}${c.voidedError > 0 ? 'e' : ''}`;

	const rows = result.cases.map(c => [
		c.caseId,
		c.samples.map(s => SAMPLE_GLYPH[s]).join(' '),
		`${c.passes}/${c.valid}`,
		voidCell(c),
		String(c.required),
		c.verdict,
		...withBaseline ? [c.baselineExpected ?? '—', c.status === 'ok' ? '' : (c.status ?? '')] : []
	]);
	const header = ['case', 'runs', 'pass', 'void', 'need', 'verdict', ...withBaseline ? ['baseline', ''] : []];
	const widths = header.map((_, column) => Math.max(header[column].length, ...rows.map(row => row[column].length)));
	const line = (cells: readonly string[]) => `  ${cells.map((cell, column) => cell.padEnd(widths[column])).join('  ')}`.trimEnd();

	lines.push(line(header));
	lines.push(`  ${'-'.repeat(line(header).length - 2)}`);
	for (const row of rows) {
		lines.push(line(row));
	}

	lines.push('');
	lines.push(`  legend: P pass · F fail · g voided (judge could not be parsed) · e voided (provider error)`);
	lines.push(`  voided samples: ${result.totalVoidedGrader} grader, ${result.totalVoidedError} provider — voided samples never count as a case failure`);
	return lines.join('\n');
}

/** Read one promptfoo output JSON. */
export function readRun(filePath: string): PromptfooRun {
	return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PromptfooRun;
}

/** Read a committed repeat baseline. */
export function readBaseline(filePath: string): RepeatBaseline {
	return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RepeatBaseline;
}

function main(): void {
	const args = process.argv.slice(2);
	const baselineFlag = args.indexOf('--baseline');
	let baseline: RepeatBaseline | undefined;
	let runPaths = args;
	if (baselineFlag !== -1) {
		baseline = readBaseline(args[baselineFlag + 1]);
		runPaths = [...args.slice(0, baselineFlag), ...args.slice(baselineFlag + 2)];
	}
	if (runPaths.length === 0) {
		console.error('usage: aggregate-repeats.ts [--baseline <baseline.json>] <run-1.json> <run-2.json> ...');
		process.exit(3);
	}

	const runs = runPaths.map(readRun);
	const result = aggregateRuns(runs, baseline?.policy ?? DEFAULT_POLICY, baseline);
	console.log(formatTable(result, path.basename(runPaths[0]).replace(/-repeat-\d+\.json$/, '')));
	process.exit(result.exitCode);
}

if (typeof require !== 'undefined' && require.main === module) {
	main();
}
