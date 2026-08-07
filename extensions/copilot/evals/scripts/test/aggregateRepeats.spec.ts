/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, PromptfooRun, RepeatBaseline, RepeatPolicy, aggregateRuns, classifySample, deficientCases, deriveCaseId, formatTable, requiredPasses } from '../aggregate-repeats';

/** A passing row. */
function pass(description: string) {
	return {
		success: true,
		failureReason: 0,
		testCase: { description },
		gradingResult: { componentResults: [{ pass: true }, { pass: true }] }
	};
}

/**
 * A row that failed a structural assert — real model behaviour.
 *
 * `error` carries the assertion text: promptfoo populates that field on ordinary ASSERT
 * failures too, so only `failureReason` may be read as the ERROR signal.
 */
function fail(description: string) {
	return {
		success: false,
		failureReason: 1,
		error: 'Custom function returned false',
		testCase: { description },
		gradingResult: { componentResults: [{ pass: true }, { pass: false }] }
	};
}

/** A row whose ONLY failing component is an unparseable judge — grader flake. */
function graderVoid(description: string) {
	return {
		success: false,
		failureReason: 1,
		error: 'Could not extract JSON from llm-rubric response',
		testCase: { description },
		gradingResult: { componentResults: [{ pass: true }, { pass: false, metadata: { graderError: true } }] }
	};
}

/** A row that failed a structural assert AND grader-errored — still a real failure. */
function failWithGraderError(description: string) {
	return {
		success: false,
		failureReason: 1,
		testCase: { description },
		gradingResult: { componentResults: [{ pass: false }, { pass: false, metadata: { graderError: true } }] }
	};
}

/** A promptfoo ERROR row — transport/provider failure. */
function errorRow(description: string) {
	return {
		success: false,
		failureReason: 2,
		error: 'OpenRouter returned finish_reason "error"',
		testCase: { description },
		gradingResult: { componentResults: [] }
	};
}

function run(...rows: ReturnType<typeof pass>[]): PromptfooRun {
	return { results: { results: rows } } as PromptfooRun;
}

const T5 = 'T5 — single-ID document lookup drops the whole record';
const T6 = 'T6 — first exact-phrase search is a clean zero';

describe('classifySample', () => {
	it('separates the four sample kinds, with a structural miss beating a concurrent grader error', () => {
		expect([
			classifySample(pass(T5)),
			classifySample(fail(T5)),
			classifySample(graderVoid(T5)),
			classifySample(failWithGraderError(T5)),
			classifySample(errorRow(T5))
		]).toEqual(['pass', 'fail', 'void-grader', 'fail', 'void-error']);
	});

	it('treats an unattributable failure (no component results) as a real failure', () => {
		expect(classifySample({ success: false, failureReason: 1, testCase: { description: T5 } })).toBe('fail');
	});

	it('reads only failureReason for ERROR — an ASSERT row also carries assertion text in `error`', () => {
		const assertRow = { success: false, failureReason: 1, error: 'Custom function returned false', testCase: { description: T5 } };
		const errorRowWithoutText = { success: false, failureReason: 2, testCase: { description: T5 } };
		expect([classifySample(assertRow), classifySample(errorRowWithoutText)]).toEqual(['fail', 'void-error']);
	});
});

describe('deriveCaseId', () => {
	it('prefers the leading case token, falls back to mockScript then the description', () => {
		expect([
			deriveCaseId({ testCase: { description: T5 } }),
			deriveCaseId({ testCase: { description: 'T3a — search endpoint 504s twice' } }),
			deriveCaseId({ testCase: { description: 'K1 — comprehensive US+EP prior art' } }),
			deriveCaseId({ testCase: { description: 'unlabelled case', vars: { mockScript: 't9-new' } } }),
			deriveCaseId({ testCase: { description: 'unlabelled case' } })
		]).toEqual(['T5', 'T3a', 'K1', 't9-new', 'unlabelled case']);
	});
});

describe('requiredPasses', () => {
	it('computes k from the exact fraction, with no float drift', () => {
		const twoThirds = DEFAULT_POLICY;
		expect([1, 2, 3, 4, 5, 6].map(valid => requiredPasses(valid, twoThirds))).toEqual([1, 2, 2, 3, 4, 4]);
	});
});

describe('aggregateRuns', () => {
	it('passes a case that fails one run of three, and reports the sample trace', () => {
		const result = aggregateRuns([run(pass(T5)), run(fail(T5)), run(pass(T5))]);
		expect(result.cases).toEqual([{
			caseId: 'T5',
			description: T5,
			samples: ['pass', 'fail', 'pass'],
			passes: 2, fails: 1, voidedGrader: 0, voidedError: 0,
			valid: 3, required: 2, verdict: 'PASS',
			baselineExpected: undefined, status: undefined
		}]);
		expect(result.exitCode).toBe(0);
	});

	it('fails a case that only passes once in three', () => {
		const result = aggregateRuns([run(pass(T5)), run(fail(T5)), run(fail(T5))]);
		expect([result.cases[0].verdict, result.cases[0].required, result.exitCode]).toEqual(['FAIL', 2, 1]);
	});

	it('voids a grader-flake sample out of the denominator instead of counting it as a failure', () => {
		const result = aggregateRuns([run(pass(T6)), run(graderVoid(T6)), run(pass(T6))]);
		expect({
			samples: result.cases[0].samples,
			valid: result.cases[0].valid,
			required: result.cases[0].required,
			verdict: result.cases[0].verdict,
			voidedGrader: result.totalVoidedGrader,
			exit: result.exitCode
		}).toEqual({ samples: ['pass', 'void-grader', 'pass'], valid: 2, required: 2, verdict: 'PASS', voidedGrader: 1, exit: 0 });
	});

	it('voids a provider-error sample the same way and counts it separately', () => {
		const result = aggregateRuns([run(pass(T5)), run(errorRow(T5)), run(pass(T5))]);
		expect({ valid: result.cases[0].valid, verdict: result.cases[0].verdict, error: result.totalVoidedError, grader: result.totalVoidedGrader })
			.toEqual({ valid: 2, verdict: 'PASS', error: 1, grader: 0 });
	});

	it('returns INCONCLUSIVE (exit 2, not 1) when voids leave too few valid samples', () => {
		const result = aggregateRuns([run(graderVoid(T6)), run(graderVoid(T6)), run(pass(T6))]);
		expect([result.cases[0].valid, result.cases[0].verdict, result.exitCode]).toEqual([1, 'INCONCLUSIVE', 2]);
	});

	it('never lets a grader void alone turn a would-be pass into a gate failure', () => {
		// Same trajectory quality, three different judge outcomes — the verdict must not move.
		const clean = aggregateRuns([run(pass(T6)), run(pass(T6)), run(pass(T6))]);
		const flaky = aggregateRuns([run(pass(T6)), run(graderVoid(T6)), run(pass(T6))]);
		expect([clean.cases[0].verdict, flaky.cases[0].verdict, clean.exitCode, flaky.exitCode]).toEqual(['PASS', 'PASS', 0, 0]);
	});

	it('aggregates several cases independently and sorts them by case id', () => {
		const result = aggregateRuns([
			run(pass(T5), fail(T6)),
			run(fail(T5), pass(T6)),
			run(pass(T5), pass(T6))
		]);
		expect(result.cases.map(c => [c.caseId, c.passes, c.valid, c.verdict])).toEqual([
			['T5', 2, 3, 'PASS'],
			['T6', 2, 3, 'PASS']
		]);
	});

	it('scales the threshold when top-ups push a case past the run count', () => {
		const result = aggregateRuns([run(pass(T5)), run(fail(T5)), run(pass(T5)), run(pass(T5)), run(fail(T5))]);
		expect([result.cases[0].valid, result.cases[0].required, result.cases[0].passes, result.cases[0].verdict]).toEqual([5, 4, 3, 'FAIL']);
	});

	it('throws when the run files hold no results at all', () => {
		expect(() => aggregateRuns([{ results: {} } as PromptfooRun])).toThrow(/zero test results/);
	});
});

describe('aggregateRuns against a committed baseline', () => {
	const baseline: RepeatBaseline = {
		updated: '2026-08-07',
		config: 'promptfooconfig.trajectory.yaml',
		policy: DEFAULT_POLICY,
		cases: { T5: { expected: 'PASS' }, T6: { expected: 'FAIL' } }
	};

	it('classifies each case against its expectation and only reds the gate on a regression', () => {
		const result = aggregateRuns([
			run(fail(T5), pass(T6)),
			run(fail(T5), pass(T6)),
			run(pass(T5), pass(T6))
		], DEFAULT_POLICY, baseline);
		expect(result.cases.map(c => [c.caseId, c.verdict, c.baselineExpected, c.status])).toEqual([
			['T5', 'FAIL', 'PASS', 'regression'],
			['T6', 'PASS', 'FAIL', 'improvement']
		]);
		expect(result.exitCode).toBe(1);
	});

	it('stays green when a known-failing case keeps failing', () => {
		const result = aggregateRuns([run(pass(T5), fail(T6)), run(pass(T5), fail(T6)), run(pass(T5), fail(T6))], DEFAULT_POLICY, baseline);
		expect([result.cases.map(c => c.status), result.exitCode]).toEqual([['ok', 'ok'], 0]);
	});

	it('requires a case absent from the baseline to pass on its own', () => {
		const result = aggregateRuns([run(pass(T5), fail(T6), fail('T9 — brand new'))], { ...DEFAULT_POLICY, minValidSamples: 1 }, baseline);
		expect(result.cases.map(c => [c.caseId, c.status])).toEqual([['T5', 'ok'], ['T6', 'ok'], ['T9', 'regression']]);
		expect(result.exitCode).toBe(1);
	});
});

describe('deficientCases', () => {
	it('lists only the cases short of valid samples — the top-up work list', () => {
		const result = aggregateRuns([run(pass(T5), graderVoid(T6)), run(pass(T5), pass(T6)), run(pass(T5), pass(T6))]);
		expect(deficientCases(result).map(c => c.caseId)).toEqual(['T6']);
	});

	it('is empty when every case has a full set of valid samples', () => {
		const result = aggregateRuns([run(pass(T5)), run(fail(T5)), run(pass(T5))]);
		expect(deficientCases(result)).toEqual([]);
	});
});

describe('formatTable', () => {
	it('renders one table with the sample trace, the void breakdown and the baseline column', () => {
		const policy: RepeatPolicy = DEFAULT_POLICY;
		const baseline: RepeatBaseline = { updated: '2026-08-07', config: 'c', policy, cases: { T5: { expected: 'PASS' }, T6: { expected: 'PASS' } } };
		const result = aggregateRuns([run(pass(T5), graderVoid(T6)), run(fail(T5), errorRow(T6)), run(pass(T5), pass(T6))], policy, baseline);
		expect(formatTable(result, 'trajectory')).toMatchInlineSnapshot(`
			"trajectory — pass 2/3 of valid samples over 3 runs (min 2 valid)

			  case  runs   pass  void  need  verdict       baseline
			  -----------------------------------------------------
			  T5    P F P  2/3   0     2     PASS          PASS
			  T6    g e P  1/1   2ge   1     INCONCLUSIVE  PASS      inconclusive

			  legend: P pass · F fail · g voided (judge could not be parsed) · e voided (provider error)
			  voided samples: 1 grader, 1 provider — voided samples never count as a case failure"
		`);
	});
});
