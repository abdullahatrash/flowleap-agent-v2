/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Offline proof of the skill-grounded suite's deterministic layer (#569).
 *
 * No model, no judge: it drives the exact predicates the skill-grounded dataset calls over
 * hand-written answers — one that follows ADR 0013 and one that commits the error each check
 * exists to catch.
 */

import { describe, expect, it } from 'vitest';
import * as H from '../skill-grounded-assertions.mjs';

describe('calendar dates (ADR 0013: never compute a date)', () => {
	it('finds every calendar-date form a deadline can take', () => {
		const answers = [
			'File the defence by 1 November 2026.',
			'Deadline: 2026-11-01.',
			'Deadline: 01.11.2026.',
			'File it by November 1st.',
			'File it by November 1, 2026.',
			'File it by 1st of November.',
			'Due on 11/01/2026.',
			'Due on 1 Nov. 2026.',
			'Due on 3 Dec.',
			'Due on Sept 30.',
		];
		expect(answers.map(a => H.hasNoCalendarDate(a))).toEqual(answers.map(() => false));
	});

	it('passes periods, trigger events, rule numbers and fee figures', () => {
		const answer = [
			'The Statement of defence is due within 3 months of service of the Statement of claim (R.23).',
			'A preliminary objection runs 1 month from service (R.19.1).',
			'The appeal period is 2 months from service of the decision, R.224.1(a); grounds within 4 months.',
			'A protective letter is valid for 6 months and costs EUR 200 (2026 table). Fixed fee EUR 11,000.',
			'Rules 300-301 govern how periods end. Use the 2023 table for actions lodged before 2026.',
			'Article 33(1)(b) UPCA. A 14-day period. In may 2 cases the court decides.',
		].join('\n');
		expect({ ok: H.hasNoCalendarDate(answer), found: H.findCalendarDates(answer) }).toEqual({ ok: true, found: [] });
	});

	it('passes the fixed legal reference dates of the 2026 fee table, in any written form', () => {
		const answer = [
			'The 2026 table is in force from 1 January 2026.',
			'Use the previous table for actions filed before 1 January 2026, i.e. on or before December 31, 2025.',
			'Actions filed after 31 December 2025 use the new table (in force 2026-01-01; also written 01.01.2026).',
			'Table adopted on 8 July 2022, amended by the decision of 4 November 2025.',
		].join('\n');
		expect({ ok: H.hasNoCalendarDate(answer), found: H.findCalendarDates(answer) }).toEqual({ ok: true, found: [] });
	});

	it('still fails every other date, also next to an allow-listed one and also an allow-listed day without its year', () => {
		expect(H.findCalendarDates('In force from 1 January 2026. File the defence by 2 January 2026 or by 1 January 2027; reply by 1 January.'))
			.toEqual(['2 January 2026', '1 January 2027', '1 January']);
	});

	it('passes number lists that are not valid dates, such as article lists', () => {
		const answer = 'Orders under Art. 60/61/62 UPCA; Art. 32/33 UPCA; RoP 13/14/15; sections 0.12.2026 and 2026-13-40; 32.1.2026.';
		expect({ ok: H.hasNoCalendarDate(answer), found: H.findCalendarDates(answer) }).toEqual({ ok: true, found: [] });
	});

	it('still fails numeric dates in the valid day and month range, day-first or month-first', () => {
		expect(H.findCalendarDates('By 31/12/2027, by 12/31/27, by 1.2.2027 or by 2027-02-28.')).toEqual(['31/12/2027', '12/31/27', '1.2.2027', '2027-02-28']);
	});

	it('names the date it found, so a failing row shows the offending text', () => {
		expect(H.findCalendarDates('Reply by 1 November 2026, rejoinder by 2027-01-01.')).toEqual(['1 November 2026', '2027-01-01']);
	});
});

describe('exact rule numbers', () => {
	it('accepts every usual citation form and rejects a near-miss number', () => {
		const answer = 'Defence under R.23; objection under Rule 19.1; appeal R. 224.1(a); reply RoP 29(b). See also R.230.';
		expect({
			cited: H.missingRules(answer, ['23', '19', '19.1', '224.1', '29']),
			nearMiss: H.missingRules(answer, ['2', '22', '24', '19.2']),
			notARule: H.missingRules('Article 33 UPCA, 3 months', ['33']),
		}).toEqual({ cited: [], nearMiss: ['2', '22', '24', '19.2'], notARule: ['33'] });
	});
});

describe('exact fee amounts', () => {
	it('reads euro amounts in English, German and French notation', () => {
		expect(H.findEuroAmounts('EUR 11,000; €200; 11.000,00 EUR; 20 000 €; 1,500 euros; 3 months; R.23')).toEqual([11000, 200, 11000, 20000, 1500]);
	});

	it('names the expected fee the answer did not state exactly', () => {
		expect(H.missingFees('Fixed fee EUR 11,000 plus a value-based fee of €110,000.', [11000, 20000, 110000])).toEqual([20000]);
	});
});

describe('answer text', () => {
	it('reads the final answer from the provider output', () => {
		expect(H.answerText(JSON.stringify({ skill: 's', loadedFiles: [], finalText: 'ok' }))).toBe('ok');
	});
});
