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
 * Fixed legal reference dates that an answer may state, as `YYYY-MM-DD`. They are not deadlines:
 * each is a date of the official fee table, taken from
 * `assets/skills/upc-filing-prep/references/fees-2026.md`. A fee answer must be able to say "in
 * force from 1 January 2026" and "actions filed before 1 January 2026" (ADR 0013, decision 4).
 * Add a date here only when it is a fixed date of the law or of an official table, never a date
 * that depends on the case.
 */
const LEGAL_REFERENCE_DATES = new Set([
	'2026-01-01', // 2026 Table of Court Fees in force; actions filed before it keep the previous table
	'2025-12-31', // "filed after 31 December 2025" (decision D-AC/08/02072025, Art. 5)
	'2025-11-04', // amending decision of the Administrative Committee
	'2022-07-08', // Table of Court Fees adopted by the Administrative Committee
]);

const MONTH_NUMBER = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function isoDate(year, month, day) {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The `YYYY-MM-DD` form of a matched date, or `undefined` when the match has no year or is
 * ambiguous (a slash date can be day-first or month-first). Only a full, unambiguous date can be
 * an allow-listed reference date.
 * @param {string} match
 */
function normalizedDate(match) {
	const numeric = /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})$/.exec(match) ?? /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{4})$/.exec(match);
	if (numeric) {
		return isoDate(numeric.groups.year, Number(numeric.groups.month), Number(numeric.groups.day));
	}
	const words = /^(?:(?<dayFirst>\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(?<monthAfterDay>[A-Za-z]+)\.?,?\s+(?<yearAfterDay>\d{4})|(?<monthFirst>[A-Za-z]+)\.?\s+(?<dayAfterMonth>\d{1,2})(?:st|nd|rd|th)?,?\s+(?<yearAfterMonth>\d{4}))$/.exec(match);
	if (words) {
		const groups = words.groups;
		const month = MONTH_NUMBER[(groups.monthAfterDay ?? groups.monthFirst).slice(0, 3).toLowerCase()];
		return month ? isoDate(groups.yearAfterDay ?? groups.yearAfterMonth, month, Number(groups.dayFirst ?? groups.dayAfterMonth)) : undefined;
	}
	return undefined;
}

/**
 * The `MM-DD` form of a word-month date written without a year ("1 October", "October 1st"), or
 * `undefined` for any other match.
 * @param {string} match
 */
function yearlessDayMonth(match) {
	const words = /^(?:(?<dayFirst>\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(?<monthAfterDay>[A-Za-z]+)|(?<monthFirst>[A-Za-z]+)\.?\s+(?<dayAfterMonth>\d{1,2})(?:st|nd|rd|th)?)\.?$/.exec(match);
	if (!words) {
		return undefined;
	}
	const groups = words.groups;
	const month = MONTH_NUMBER[(groups.monthAfterDay ?? groups.monthFirst).slice(0, 3).toLowerCase()];
	return month ? isoDate('0000', month, Number(groups.dayFirst ?? groups.dayAfterMonth)).slice(5) : undefined;
}

const isDay = value => value >= 1 && value <= 31;
const isMonth = value => value >= 1 && value <= 12;

/**
 * True when the day and month of a numeric match are in range, so that a number list such as
 * "Art. 60/61/62" or "RoP 13/14/15" is not read as a date. A slash date passes when it is valid
 * day-first or month-first. Word-month forms are always in range for the month; their day is checked.
 * @param {string} match
 */
function isInDateRange(match) {
	const numeric = /^\d{4}-(?<month>\d{1,2})-(?<day>\d{1,2})$/.exec(match) ?? /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.\d{4}$/.exec(match);
	if (numeric) {
		return isDay(Number(numeric.groups.day)) && isMonth(Number(numeric.groups.month));
	}
	const slash = /^(?<first>\d{1,2})\/(?<second>\d{1,2})\//.exec(match);
	if (slash) {
		const first = Number(slash.groups.first);
		const second = Number(slash.groups.second);
		return (isDay(first) && isMonth(second)) || (isMonth(first) && isDay(second));
	}
	const day = /\d{1,2}(?!\d)/.exec(match.replace(/\d{4}/, ''));
	return !day || isDay(Number(day[0]));
}

/**
 * Every calendar-date match in the text that is a valid date, in order of appearance, without
 * trailing punctuation.
 * @param {string} text
 * @returns {string[]}
 */
function calendarDateMatches(text) {
	return [...String(text ?? '').matchAll(CALENDAR_DATE)]
		.map(match => match[0].replace(/[.,\s]+$/, ''))
		.filter(isInDateRange);
}

/** The same date text with case and spacing removed, for an exact comparison. */
const comparableText = date => date.toLowerCase().replace(/\s+/g, ' ');

/**
 * A test for "this date is one the user gave in the prompt". A date in the answer counts as the
 * prompt's date when it is written the same way, or is the same full date in another form
 * ("2026-10-01" for "1 October 2026"), or is the same day and month without a year ("1 October").
 * An ambiguous slash date counts only when written exactly as in the prompt.
 * @param {string} promptText
 * @returns {(date: string) => boolean}
 */
function promptDateTest(promptText) {
	const promptDates = calendarDateMatches(promptText);
	const texts = new Set(promptDates.map(comparableText));
	const fullDates = new Set(promptDates.map(normalizedDate).filter(Boolean));
	const dayMonths = new Set([...fullDates].map(date => date.slice(5)));
	return date => {
		if (texts.has(comparableText(date))) {
			return true;
		}
		const full = normalizedDate(date);
		if (full) {
			return fullDates.has(full);
		}
		const dayMonth = yearlessDayMonth(date);
		return dayMonth !== undefined && dayMonths.has(dayMonth);
	};
}

/**
 * Every calendar date in the text, in order of appearance, except number lists that are not valid
 * dates (see {@link isInDateRange}), the fixed legal reference dates of
 * {@link LEGAL_REFERENCE_DATES} written with their year, and the dates the user gave in the prompt
 * (an answer may repeat the service date it was told; it may not compute a new one).
 * A period ("2 months from service"), a rule number ("R.224.1(a)") or a bare year ("the 2026
 * table") is not a calendar date.
 * @param {string} text
 * @param {string} [promptText] The user's question; its dates are allowed in the answer.
 * @returns {string[]}
 */
export function findCalendarDates(text, promptText = '') {
	const isPromptDate = promptDateTest(promptText);
	return calendarDateMatches(text)
		.filter(date => !LEGAL_REFERENCE_DATES.has(normalizedDate(date)) && !isPromptDate(date));
}

/**
 * True when the answer gives no calendar date (ADR 0013, decision 3), other than a date the user
 * gave in the prompt.
 * @param {string} text
 * @param {string} [promptText]
 */
export function hasNoCalendarDate(text, promptText = '') {
	return findCalendarDates(text, promptText).length === 0;
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
