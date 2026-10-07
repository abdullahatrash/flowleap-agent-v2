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

const termPattern = /\b(?<article>a plurality of|plurality of|at least one|one or more|an|a|the|said)\s+(?:(?:at least one|one or more|plurality of)\s+)?(?<first>[a-z][a-z0-9-]*)/gi;

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
		const key = termModifiers.has(first) && second ? `${first} ${second}` : first;
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

/** Note when the claim count passes the office fee threshold (US: 20 total, 3 independent; EPO: 15). */
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
		findings.push(note(`${claims.length} claims in total: the EPO claims fee is due for each claim over 15 (Rule 45 EPC).`));
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
