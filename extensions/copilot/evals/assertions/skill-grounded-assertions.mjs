/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic assertion helpers for the skill-grounded suite (#569, PRD 0021 U6).
 *
 * Same contract as {@link file://./trajectory-assertions.mjs}: plain-JS ESM, so promptfoo's inline
 * `javascript` sandbox and the offline vitest spec run the identical predicates. Every helper is a
 * pure function over the agent's final answer text.
 *
 * The checks encode ADR 0013 for UPC skills:
 * - an answer never gives a calendar date (it gives the rule, the period and the trigger event);
 * - a rule the case expects is cited with its exact number;
 * - a fee the case expects appears as its exact euro amount.
 *
 * Completeness is not checked here — the `llm-rubric` layer in the dataset grades that.
 */

/** English month names and their usual abbreviations. "May" must be capitalised, so the verb "may" is not a month. */
const MONTH = '(?:[Jj]an(?:uary)?|[Ff]eb(?:ruary)?|[Mm]ar(?:ch)?|[Aa]pr(?:il)?|May|[Jj]une?|[Jj]uly?|[Aa]ug(?:ust)?|[Ss]ep(?:t(?:ember)?)?|[Oo]ct(?:ober)?|[Nn]ov(?:ember)?|[Dd]ec(?:ember)?)\\.?';
const ORDINAL = '(?:st|nd|rd|th)?';

/**
 * One alternation per calendar-date form. Order matters only for overlap: the longest form at a
 * position wins because each alternative takes its optional year greedily.
 */
const CALENDAR_DATE = new RegExp([
	// 2026-11-01
	'\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b',
	// 01.11.2026, 11/01/2026, 1/11/26 (same separator twice; 2-digit year only with a slash)
	'\\b\\d{1,2}\\.\\d{1,2}\\.\\d{4}\\b',
	'\\b\\d{1,2}/\\d{1,2}/(?:\\d{4}|\\d{2})\\b',
	// 1 November 2026, 1st of November, 3 Dec.
	`\\b\\d{1,2}${ORDINAL}(?:\\s+of)?\\s+${MONTH}(?![A-Za-z])(?:,?\\s+\\d{4}\\b)?`,
	// November 1st, November 1, 2026, Sept 30
	`\\b${MONTH}(?![A-Za-z])\\s+\\d{1,2}${ORDINAL}\\b(?:,?\\s+\\d{4}\\b)?`,
].join('|'), 'g');

/**
 * Every calendar date in the text, in order of appearance.
 * A period ("2 months from service"), a rule number ("R.224.1(a)") or a bare year ("the 2026
 * table") is not a calendar date.
 * @param {string} text
 * @returns {string[]}
 */
export function findCalendarDates(text) {
	return [...String(text ?? '').matchAll(CALENDAR_DATE)].map(match => match[0].replace(/[.,\s]+$/, ''));
}

/**
 * True when the answer gives no calendar date (ADR 0013, decision 3).
 * @param {string} text
 */
export function hasNoCalendarDate(text) {
	return findCalendarDates(text).length === 0;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The expected Rules of Procedure numbers that the answer does not cite.
 *
 * A rule counts as cited when its exact number follows a rule marker: `R.23`, `R. 23`, `Rule 23`,
 * `Rules 23`, `RoP 23`. The number must not run on into another digit, so `R.230` does not cite
 * Rule 23, but `R.23.1` does (it is a paragraph of Rule 23). Give a paragraph (`'224.1'`) to
 * require that paragraph.
 * @param {string} text
 * @param {string[]} expected Rule numbers, for example `['23', '224.1']`.
 * @returns {string[]}
 */
export function missingRules(text, expected) {
	const answer = String(text ?? '');
	return expected.filter(rule => !new RegExp(`(?:\\bR\\.\\s?|\\bRules?\\s+|\\bRoP\\s+)${escapeRegExp(rule)}(?!\\d)`, 'i').test(answer));
}

/** A euro amount with the currency before or after it: `EUR 11,000`, `€200`, `11 000 €`, `11.000,00 EUR`. */
const NUMBER = '\\d{1,3}(?:[,.\\u00a0\\u202f ]\\d{3})+|\\d+';
const DECIMALS = '(?:[.,]\\d{2}(?!\\d))?';
const CURRENCY = '(?:€|EUR\\b|euros?\\b)';
const EURO_AMOUNT = new RegExp(`${CURRENCY}\\s?(?<before>${NUMBER})${DECIMALS}|(?<after>${NUMBER})${DECIMALS}\\s?${CURRENCY}`, 'gi');

/**
 * Every euro amount in the text, as whole euros, in order of appearance.
 * @param {string} text
 * @returns {number[]}
 */
export function findEuroAmounts(text) {
	return [...String(text ?? '').matchAll(EURO_AMOUNT)].map(match => Number((match.groups.before ?? match.groups.after).replace(/\D/g, '')));
}

/**
 * The expected fee amounts (whole euros) that the answer does not state exactly.
 * @param {string} text
 * @param {number[]} expected For example `[11000, 200]`.
 * @returns {number[]}
 */
export function missingFees(text, expected) {
	const found = new Set(findEuroAmounts(text));
	return expected.filter(amount => !found.has(amount));
}

/**
 * The agent's final answer, from the JSON string the skill-grounded provider returns or from an
 * already-parsed object.
 * @param {unknown} output
 * @returns {string}
 */
export function answerText(output) {
	const parsed = typeof output === 'string' ? JSON.parse(output) : output;
	if (!parsed || typeof parsed.finalText !== 'string') {
		throw new Error('answerText: output is not a skill-grounded result with a finalText string');
	}
	return parsed.finalText;
}
