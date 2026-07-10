/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareBaseline } from '../compare-baseline';

/** Build a minimal promptfoo latest.json with the given pass/fail counts. */
function latestFixture(successes: number, failures: number, errors = 0) {
	return {
		results: {
			stats: { successes, failures, errors },
			results: [
				...Array.from({ length: successes }, () => ({ success: true })),
				...Array.from({ length: failures + errors }, () => ({ success: false })),
			],
		},
	};
}

function baselineFixture(passRate: number) {
	return {
		updated: '2026-06-12',
		config: 'promptfooconfig.yaml',
		totalTests: 34,
		passing: Math.round(passRate * 34),
		passRate,
		notes: 'test fixture',
	};
}

describe('compare-baseline', () => {
	let tmpDir: string;
	let latestPath: string;
	let baselinePath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-baseline-'));
		latestPath = path.join(tmpDir, 'latest.json');
		baselinePath = path.join(tmpDir, 'baseline.json');
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const write = (latest: unknown, baseline: unknown) => {
		fs.writeFileSync(latestPath, JSON.stringify(latest));
		fs.writeFileSync(baselinePath, JSON.stringify(baseline));
	};

	it('passes when current rate equals the baseline', () => {
		write(latestFixture(34, 0), baselineFixture(1.0));
		const result = compareBaseline(latestPath, baselinePath);
		expect(result.currentRate).toBe(1.0);
		expect(result.baselineRate).toBe(1.0);
		expect(result.pass).toBe(true);
	});

	it('passes when current rate is within the 0.02 tolerance below baseline', () => {
		// 33/34 = 0.9706 — drop of 0.0294 exceeds tolerance, so use a larger suite:
		// 99/100 = 0.99, drop of 0.01 from 1.0 is within tolerance.
		write(latestFixture(99, 1), baselineFixture(1.0));
		const result = compareBaseline(latestPath, baselinePath);
		expect(result.currentRate).toBeCloseTo(0.99, 5);
		expect(result.pass).toBe(true);
	});

	it('fails when current rate drops below baseline minus tolerance', () => {
		// 29/34 = 0.8529 — well below 1.0 - 0.02.
		write(latestFixture(29, 5), baselineFixture(1.0));
		const result = compareBaseline(latestPath, baselinePath);
		expect(result.currentRate).toBeCloseTo(29 / 34, 5);
		expect(result.baselineRate).toBe(1.0);
		expect(result.pass).toBe(false);
	});

	it('counts errors as failures when computing the rate', () => {
		write(latestFixture(30, 2, 2), baselineFixture(1.0));
		const result = compareBaseline(latestPath, baselinePath);
		expect(result.currentRate).toBeCloseTo(30 / 34, 5);
		expect(result.pass).toBe(false);
	});

	it('passes when current rate exceeds the baseline (improvement direction)', () => {
		write(latestFixture(34, 0), baselineFixture(0.9));
		const result = compareBaseline(latestPath, baselinePath);
		expect(result.currentRate).toBe(1.0);
		expect(result.baselineRate).toBe(0.9);
		expect(result.pass).toBe(true);
	});

	it('falls back to per-result success flags when stats are absent', () => {
		const latest = {
			results: {
				results: [{ success: true }, { success: true }, { success: false }],
			},
		};
		write(latest, baselineFixture(1.0));
		const result = compareBaseline(latestPath, baselinePath);
		expect(result.currentRate).toBeCloseTo(2 / 3, 5);
		expect(result.pass).toBe(false);
	});

	it('throws when the latest file exposes no success signal', () => {
		write({ results: {} }, baselineFixture(1.0));
		expect(() => compareBaseline(latestPath, baselinePath)).toThrow(/neither results.stats nor per-result/);
	});

	it('throws on zero test results', () => {
		write(latestFixture(0, 0), baselineFixture(1.0));
		expect(() => compareBaseline(latestPath, baselinePath)).toThrow(/zero test results/);
	});
});
