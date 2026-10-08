/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic claim validators of Application Drafting (ADR 0012 decision 4). Each takes
 * parsed claims and returns Findings with the claim number and its line in `claims.md`.
 * No model call.
 */

import { DraftClaim } from './claims';
import { DraftFinding } from './finding';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftingOffice } from './frontmatter';
import { figureNamePattern, hasFigures, parseFigureParts, readReferenceSigns } from './specValidators';

const claimsFile = DRAFTING_FILE_NAMES.claims;

function claimFinding(severity: DraftFinding['severity'], rule: string, claim: DraftClaim, message: string): DraftFinding {
	return { severity, rule, file: claimsFile, line: claim.line, claim: claim.number, message };
}

/** Error when a claim depends on a claim that does not exist or does not precede it. */
export function checkDependencyTargets(claims: readonly DraftClaim[]): DraftFinding[] {
	const numbers = new Set(claims.map(claim => claim.number));
	const findings: DraftFinding[] = [];
	for (const claim of claims) {
		for (const target of claim.dependsOn) {
			if (!numbers.has(target)) {
				findings.push(claimFinding('Error', 'dependency-target', claim, `Claim ${claim.number} depends on claim ${target}, which does not exist.`));
			} else if (target >= claim.number) {
				findings.push(claimFinding('Error', 'dependency-target', claim, `Claim ${claim.number} depends on claim ${target}, which does not precede it.`));
			}
		}
	}
	return findings;
}

/** Error when claims are not numbered 1 to n in order, without gaps or duplicates. */
export function checkClaimNumbering(claims: readonly DraftClaim[]): DraftFinding[] {
	const findings: DraftFinding[] = [];
	const seen = new Set<number>();
	claims.forEach((claim, index) => {
		if (seen.has(claim.number)) {
			findings.push(claimFinding('Error', 'claim-numbering', claim, `Claim number ${claim.number} is used more than once.`));
		} else if (claim.number !== index + 1) {
			const previous = index > 0 ? `follows claim ${claims[index - 1].number}` : 'is the first claim';
			findings.push(claimFinding('Error', 'claim-numbering', claim, `Claim ${claim.number} ${previous}; claims must be numbered 1 to ${claims.length} without gaps.`));
		}
		seen.add(claim.number);
	});
	return findings;
}

/** EPO, Rule 43(2) EPC: Error for a second independent claim in the same category. */
export function checkEpoOneIndependentPerCategory(claims: readonly DraftClaim[]): DraftFinding[] {
	const first = new Map<string, DraftClaim>();
	const findings: DraftFinding[] = [];
	for (const claim of claims) {
		if (claim.dependsOn.length) {
			continue;
		}
		const earlier = first.get(claim.category);
		if (earlier) {
			findings.push(claimFinding('Error', 'epo-one-independent-per-category', claim, `Claims ${earlier.number} and ${claim.number} are both independent ${claim.category} claims. Rule 43(2) EPC allows more than one independent claim in a category only for interrelated products, different uses of a product or a known substance, or alternative solutions where one claim is not appropriate. Waive with the exception that applies, or combine the claims.`));
		} else {
			first.set(claim.category, claim);
		}
	}
	return findings;
}

/** US, 35 U.S.C. 112(e): Error for a multiple dependent claim that depends on another one. */
export function checkUsMultipleDependency(claims: readonly DraftClaim[]): DraftFinding[] {
	const multiple = new Set(claims.filter(claim => claim.dependsOn.length > 1).map(claim => claim.number));
	const findings: DraftFinding[] = [];
	for (const claim of claims) {
		if (!multiple.has(claim.number)) {
			continue;
		}
		for (const target of claim.dependsOn) {
			if (multiple.has(target)) {
				findings.push(claimFinding('Error', 'us-multiple-dependency', claim, `Claim ${claim.number} is a multiple dependent claim and depends on claim ${target}, which is also a multiple dependent claim (35 U.S.C. 112(e), 37 CFR 1.75(c)).`));
			}
		}
	}
	return findings;
}

/**
 * Words that make a two-word claim term (`first lever`, `upper arm`). Any other first word is
 * the term on its own (`lever`): a heuristic that keeps false Errors low.
 */
const termModifiers = new Set(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'further', 'additional', 'upper', 'lower', 'inner', 'outer', 'front', 'rear', 'left', 'right', 'top', 'bottom', 'main', 'primary', 'secondary', 'proximal', 'distal']);

/** Words after "the" that are not claim terms (`the same`, `the other`). */
const exemptReferences = new Set(['same', 'other', 'like', 'invention', 'plurality', 'following', 'preceding', 'foregoing', 'above', 'below', 'present', 'respective', 'claim', 'claims']);

/**
 * Number words that introduce a term without an article ("two disks", "at least three positions").
 * A reference to such a term keeps the quantifier ("the at least three positions"), so the
 * quantifier is skipped on both sides and the term key is the noun phrase after it.
 */
const numberWords = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const termPattern = new RegExp(
	String.raw`\b(?<article>a plurality of|plurality of|at least one|one or more|an|a|the|said|at least|at most|no more than|${numberWords})\s+` +
	String.raw`(?:(?:at least one|one or more|plurality of|at least|at most|no more than)\s+)?(?:(?:${numberWords}|\d+)\s+)?(?<first>[a-z][a-z0-9-]*)`,
	'gi');

interface ClaimTerm {
	readonly key: string;
	readonly introduces: boolean;
	readonly index: number;
}

function readTerms(text: string): ClaimTerm[] {
	const terms: ClaimTerm[] = [];
	for (const match of text.matchAll(termPattern)) {
		const groups = match.groups!;
		const first = groups.first.toLowerCase();
		const index = match.index ?? 0;
		const second = /^\s+(?<second>[a-z][a-z0-9-]*)/i.exec(text.slice(index + match[0].length))?.groups?.second.toLowerCase();
		const key = second && (termModifiers.has(first) || first.endsWith('ly')) ? `${first} ${second}` : first;
		const article = groups.article.toLowerCase();
		const introduces = article !== 'the' && article !== 'said';
		if (!introduces && exemptReferences.has(first)) {
			continue;
		}
		terms.push({ key, introduces, index });
	}
	return terms;
}

/** Singular form for matching `arms` against `arm`. */
function stem(key: string): string {
	return key.replace(/(?<!s)s$/, '');
}

/** The dependency paths of a claim, root first, each ending with the claim itself. */
function dependencyPaths(claim: DraftClaim, byNumber: Map<number, DraftClaim>, depth = 0): DraftClaim[][] {
	const parents = claim.dependsOn.map(target => byNumber.get(target)).filter((parent): parent is DraftClaim => !!parent && parent.number < claim.number);
	if (!parents.length || depth > 50) {
		return [[claim]];
	}
	return parents.flatMap(parent => dependencyPaths(parent, byNumber, depth + 1)).map(path => [...path, claim]);
}

/**
 * Error when a claim refers to "the X" or "said X" and no earlier "a X" introduces it, in the
 * claim itself or along any of its dependency paths.
 */
export function checkAntecedentBasis(claims: readonly DraftClaim[]): DraftFinding[] {
	const byNumber = new Map(claims.map(claim => [claim.number, claim]));
	const findings: DraftFinding[] = [];
	for (const claim of claims) {
		const paths = dependencyPaths(claim, byNumber);
		const own = readTerms(claim.text);
		const reported = new Set<string>();
		for (const reference of own.filter(term => !term.introduces)) {
			if (reported.has(reference.key)) {
				continue;
			}
			const matches = (term: ClaimTerm) => term.introduces && stem(term.key) === stem(reference.key);
			const introducedEarlier = own.some(term => term.index < reference.index && matches(term));
			const failing = introducedEarlier ? [] : paths.filter(path => !path.slice(0, -1).some(ancestor => readTerms(ancestor.text).some(matches)));
			if (!failing.length) {
				continue;
			}
			reported.add(reference.key);
			const pathNote = failing.length < paths.length ? ` (dependency path ${failing[0].map(step => step.number).join(' → ')})` : '';
			const article = /^[aeiou]/.test(reference.key) ? 'an' : 'a';
			findings.push(claimFinding('Error', 'antecedent-basis', claim, `Claim ${claim.number}: "the ${reference.key}" has no antecedent basis ("${article} ${reference.key}") earlier in claim ${claim.number} or in the claims it depends on${pathNote}.`));
		}
	}
	return findings;
}

/** Words that end a claim term phrase: connectors, relative pronouns and the next article. */
const phraseStops = new Set(['and', 'or', 'that', 'which', 'wherein', 'configured', 'for', 'to', 'of', 'having', 'comprising', 'including', 'a', 'an', 'the', 'said']);

const introducingPattern = /\b(?:a plurality of|plurality of|at least one|one or more|an|a)\s+(?:(?:at least one|one or more|plurality of)\s+)?/gi;

/** The words of a text in order, lower case; numbers, reference signs and punctuation are left out. */
function words(text: string): string[] {
	return text.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [];
}

/** Singular form of one word: `housings` and `boxes` match `housing` and `box`. */
function singular(word: string): string {
	return /(?:x|ch|sh|ss)es$/.test(word) ? word.slice(0, -2) : word.replace(/(?<!s)s$/, '');
}

/**
 * The claim term phrases a claim introduces: after "a", "an", "a plurality of", ... all words up
 * to the next comma, semicolon or other punctuation, a stop word (`and`, `or`, `that`, `which`,
 * `wherein`, `configured`, `for`, `to`, `of`, `having`, `comprising`, `including`, an article),
 * a number or the end.
 */
function introducedPhrases(text: string): string[] {
	const phrases: string[] = [];
	for (const match of text.matchAll(introducingPattern)) {
		const phrase: string[] = [];
		for (const token of text.slice((match.index ?? 0) + match[0].length).split(/\s+/)) {
			const word = /^[a-z][a-z0-9-]*/i.exec(token)?.[0].toLowerCase();
			if (!word || phraseStops.has(word)) {
				break;
			}
			phrase.push(word);
			if (word.length !== token.length) {
				break;
			}
		}
		if (phrase.length) {
			phrases.push(phrase.join(' '));
		}
	}
	return phrases;
}

/**
 * Error when a claim term phrase a claim introduces ("a lower lever arm that ...") does not appear
 * verbatim in the description (literal basis), case-insensitive and plural-normalised; reference
 * numerals and punctuation in the description are ignored. Each phrase is reported once, at the
 * first claim that introduces it.
 */
export function checkLiteralBasis(claims: readonly DraftClaim[], description: string): DraftFinding[] {
	const text = ` ${words(description).map(singular).join(' ')} `;
	const reported = new Set<string>();
	const findings: DraftFinding[] = [];
	for (const claim of claims) {
		for (const phrase of introducedPhrases(claim.text)) {
			const normalised = phrase.split(' ').map(singular).join(' ');
			if (reported.has(normalised)) {
				continue;
			}
			reported.add(normalised);
			if (!text.includes(` ${normalised} `)) {
				findings.push(claimFinding('Error', 'literal-basis', claim, `The claim term "${phrase}" (claim ${claim.number}) does not appear in the description.`));
			}
		}
	}
	return findings;
}

/**
 * Note when the claim count passes the office fee threshold (US: 20 total, 3 independent; EPO: 15,
 * with a higher claims fee from the 51st claim).
 */
export function checkClaimCount(claims: readonly DraftClaim[], office: 'US' | 'EPO'): DraftFinding[] {
	const findings: DraftFinding[] = [];
	const note = (message: string): DraftFinding => ({ severity: 'Note', rule: 'claim-count', file: claimsFile, message });
	if (office === 'US') {
		const independent = claims.filter(claim => !claim.dependsOn.length).length;
		if (claims.length > 20) {
			findings.push(note(`${claims.length} claims in total: the US fee covers 20; each further claim incurs an excess-claims fee (37 CFR 1.16(i)).`));
		}
		if (independent > 3) {
			findings.push(note(`${independent} independent claims: the US fee covers 3; each further independent claim incurs an excess-claims fee (37 CFR 1.16(h)).`));
		}
	} else if (claims.length > 15) {
		findings.push(note(`${claims.length} claims in total: the EPO claims fee is due for each claim over 15, at a higher rate from the 51st claim (Rule 45(1) EPC; RFees Art. 2(1) item 15).`));
	}
	return findings;
}

const relativeTermPattern = /\b(?<term>about|approximately|substantially|generally|relatively|essentially|roughly|nearly)\b/gi;

/** Note per claim that uses relative terms ("about", "substantially"). */
export function checkRelativeTerms(claims: readonly DraftClaim[]): DraftFinding[] {
	const findings: DraftFinding[] = [];
	for (const claim of claims) {
		const terms = [...new Set([...claim.text.matchAll(relativeTermPattern)].map(match => match.groups!.term.toLowerCase()))];
		if (terms.length) {
			findings.push(claimFinding('Note', 'relative-term', claim, `Claim ${claim.number} uses relative terms: ${terms.map(term => `"${term}"`).join(', ')}. Check that the description gives them a definite meaning.`));
		}
	}
	return findings;
}

/**
 * Abbreviations that end with a period inside a sentence (lower case, without the period).
 * `wt.%` and decimal numbers need no entry: a period followed by a non-space never ends a sentence.
 */
const abbreviations = new Set(['e.g', 'eg', 'i.e', 'ie', 'u.s', 'etc', 'approx', 'appr', 'apprx', 'ca', 'cf', 'vs', 'resp', 'incl', 'esp', 'max', 'min', 'fig', 'figs', 'no', 'nos', 'wt', 'vol', 'mol', 'temp', 'eq', 'ref', 'al', 'conc', 'pp', 'inc', 'ltd', 'co', 'corp']);

/**
 * True when the word before a period is a step or item label, not the end of a sentence: a
 * single letter (`a.`), a roman numeral with optional parentheses (`ii.`, `(iv).`), or a number
 * of one or two digits (`1.`, `(2).`) at the start of the claim or after `;`, `:` or `(`.
 */
function isLabel(word: string, before: string): boolean {
	const bare = word.replace(/^\(/, '').replace(/\)$/, '');
	if (/^(?:[a-z]|[ivx]+)$/i.test(bare)) {
		return true;
	}
	return /^\d{1,2}$/.test(bare) && (word.startsWith('(') || /(?:^|[;:(])\s*$/.test(before));
}

/**
 * Error when a claim has a period that ends a sentence before its final period: a period followed
 * by white space, after a word that is not an abbreviation (`e.g.`, `approx.`, `Fig.`, `No.`,
 * `Inc.`) and not a step or item label (`a.`, `(ii).`, `1. heating; 2. cooling`). A claim is one
 * sentence (Guidelines F-IV, 4.1; MPEP 608.01(m)).
 */
export function checkClaimOneSentence(claims: readonly DraftClaim[]): DraftFinding[] {
	const findings: DraftFinding[] = [];
	for (const claim of claims) {
		for (const match of claim.text.matchAll(/(?<word>\S+)\.\s+\S/g)) {
			const word = match.groups!.word.replace(/^["'“]+/, '');
			const start = (match.index ?? 0) + match.groups!.word.length - word.length;
			if (abbreviations.has(word.replace(/^\(+/, '').toLowerCase()) || isLabel(word, claim.text.slice(0, start))) {
				continue;
			}
			const before = claim.text.slice(0, (match.index ?? 0) + match.groups!.word.length).split(/\s+/).slice(-3).join(' ');
			findings.push(claimFinding('Error', 'claim-one-sentence', claim, `Claim ${claim.number} has a period inside the claim, after "${before}". A claim is one sentence with one period at its end (Guidelines F-IV, 4.1; MPEP 608.01(m)).`));
			break;
		}
	}
	return findings;
}

/** What a claim refers to after `as shown in`: a figure, the drawings, the description or an example. */
const descriptionTarget = String.raw`\s+(?:in|on|by|with\s+reference\s+to)\s+(?:the\s+)?(?:(?:[Ff]igs?\.?|[Ff]igures?|FIGS?\.?|FIGURES?)\s*\d+[a-zA-Z]?\b|(?:[Ff]igures|FIGURES|drawings?|description|specification)\b|examples?(?:\s+\d+)?\b)`;

/** Not a reference to the description: `as described in claim 1`, `as set forth in any one of claims 1 to 3`. */
const notClaimReference = String.raw`(?!\s+in\s+(?:any\s+(?:one\s+)?of\s+)?claims?\b)`;

/**
 * Phrases by which a claim relies on the description or drawings, Rule 43(6) EPC:
 *
 * - `as described`, `as illustrated`, `as depicted`, `as set forth`, and any verb after
 *   `hereinbefore`, `herein` or `hereinafter`, also on their own; `as described in claim 1`
 *   refers to a claim and is left out.
 * - `as shown`, `as represented`, `as disclosed` only with what they refer to (`as shown in
 *   Fig. 2`, `as disclosed in the description`): on their own they are ordinary words
 *   (`as shown to the user`).
 * - A figure name ({@link figureNamePattern}): `FIG. 3a`, `Figure 2`, not `a figure 8 track`.
 */
const descriptionReferencePattern = new RegExp(
	String.raw`\b[Aa]s\s+(?:substantially\s+)?(?:hereinbefore|herein|hereinafter)\s+(?:substantially\s+)?(?:described|shown|illustrated|depicted|disclosed|represented|set\s+forth)\b${notClaimReference}(?:${descriptionTarget})?` +
	String.raw`|\b[Aa]s\s+(?:substantially\s+)?(?:described|illustrated|depicted|set\s+forth)\b${notClaimReference}(?:${descriptionTarget})?` +
	String.raw`|\b[Aa]s\s+(?:substantially\s+)?(?:shown|represented|disclosed)${descriptionTarget}` +
	`|${figureNamePattern.source}`,
	'g');

/**
 * Finding per claim that relies on references to the description or drawings ("as shown in
 * Fig. 2"): an Error for EPO (Rule 43(6) EPC, "except where absolutely necessary", so it can be
 * waived), a Note for US (MPEP 2173.05(s)).
 */
export function checkClaimReferencesToDescription(claims: readonly DraftClaim[], office: DraftingOffice): DraftFinding[] {
	const findings: DraftFinding[] = [];
	for (const claim of claims) {
		const phrases = [...new Set([...claim.text.matchAll(descriptionReferencePattern)].map(match => match[0]))];
		if (!phrases.length) {
			continue;
		}
		const quoted = phrases.map(phrase => `"${phrase}"`).join(', ');
		findings.push(office === 'US'
			? claimFinding('Note', 'claim-refers-to-description', claim, `Claim ${claim.number} relies on a reference to the description or drawings: ${quoted}. A US claim incorporates the description or drawings by reference only in exceptional cases (MPEP 2173.05(s)): state the feature in words.`)
			: claimFinding('Error', 'claim-refers-to-description', claim, `Claim ${claim.number} relies on a reference to the description or drawings: ${quoted}. Rule 43(6) EPC allows this only where absolutely necessary: state the feature in words, or waive with the reason.`));
	}
	return findings;
}

/**
 * EPO, Rule 43(7) EPC: Notes when `figures.md` lists parts and a claim writes a reference sign of
 * `figures.md` without parentheses (`housing 12`), or no claim has a reference sign at all. A
 * reference sign is a number after a word, as `readReferenceSigns` reads it; only numerals that
 * `figures.md` lists count, so `claim 1` and quantities never do.
 */
export function checkEpoClaimReferenceSigns(claims: readonly DraftClaim[], figures: string): DraftFinding[] {
	const parts = parseFigureParts(figures);
	const numerals = new Set(parts.map(part => part.numeral));
	if (!hasFigures(figures) || !parts.length) {
		return [];
	}
	const findings: DraftFinding[] = [];
	let anySign = false;
	for (const claim of claims) {
		const signs = readReferenceSigns(claim.text).filter(sign => numerals.has(sign.numeral));
		anySign ||= signs.length > 0;
		const bare = signs.filter(sign => !sign.parenthesised);
		if (bare.length) {
			const written = [...new Set(bare.map(sign => `"${sign.word} ${sign.numeral}"`))].join(', ');
			findings.push(claimFinding('Note', 'epo-claim-reference-signs', claim, `Claim ${claim.number} writes ${written}: Rule 43(7) EPC puts reference signs in parentheses after the feature, e.g. "${bare[0].word} (${bare[0].numeral})".`));
		}
	}
	if (!anySign && claims.length) {
		findings.push({ severity: 'Note', rule: 'epo-claim-reference-signs', file: claimsFile, message: `No claim has a reference sign, but figures.md lists parts. Rule 43(7) EPC: technical features in the claims are preferably followed by their reference signs in parentheses, e.g. "${parts[0].part} (${parts[0].numeral})".` });
	}
	return findings;
}
