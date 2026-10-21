/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseClaims, removeClaim } from '../drafting/claims';
import { pipeClampClaims } from './draftingTestClaims';

describe('Application Drafting claim parsing', () => {

	it('parses numbered claims, dependencies, ranges and categories', () => {
		const claims = [
			'---',
			'approved: true',
			'---',
			'# Claims',
			'',
			'1. A hinge, comprising:',
			'   a housing; and',
			'   a lever.',
			'2. The hinge of claim 1, wherein the lever is steel.',
			'3) The hinge according to claim 1 or 2, further comprising a spring.',
			'4. The hinge as claimed in any one of claims 1 to 3, wherein the spring is coiled.',
			'5. A method of assembling a hinge, comprising fitting a lever.',
			'6. Use of the hinge according to claims 1-2 in a door.',
		].join('\n');
		expect(parseClaims(claims)).toEqual([
			{ number: 1, line: 6, text: 'A hinge, comprising: a housing; and a lever.', dependsOn: [], category: 'product' },
			{ number: 2, line: 9, text: 'The hinge of claim 1, wherein the lever is steel.', dependsOn: [1], category: 'product' },
			{ number: 3, line: 10, text: 'The hinge according to claim 1 or 2, further comprising a spring.', dependsOn: [1, 2], category: 'product' },
			{ number: 4, line: 11, text: 'The hinge as claimed in any one of claims 1 to 3, wherein the spring is coiled.', dependsOn: [1, 2, 3], category: 'product' },
			{ number: 5, line: 12, text: 'A method of assembling a hinge, comprising fitting a lever.', dependsOn: [], category: 'process' },
			{ number: 6, line: 13, text: 'Use of the hinge according to claims 1-2 in a door.', dependsOn: [1, 2], category: 'use' },
		]);
	});
});

/** The lines of the claims file after a removal, each cut at 60 characters, and the renumbered pairs; or the refusal. */
function removalOutline(text: string, number: number) {
	const removal = removeClaim(text, number);
	if (!removal.removed) {
		return removal;
	}
	return { ...removal, renumbered: removal.renumbered.map(({ from, to }) => `${from} -> ${to}`), text: removal.text.split('\n').map(line => line.length > 60 ? `${line.slice(0, 60)}...` : line) };
}

describe('Application Drafting claim removal', () => {

	it('a middle claim: removes claim 4 of 14, the later claims and their references move down by one', () => {
		expect(removalOutline(pipeClampClaims, 4)).toMatchSnapshot();
	});

	it('the last claim: removes claim 14 with the blank line before it; no claim is renumbered', () => {
		expect(removalOutline(pipeClampClaims, 14)).toMatchSnapshot();
	});

	it('a dependent chain: removes claim 3 at the end of the chain 1-2-3; the chains 5-6 and 12-13-14 move down together', () => {
		expect(removalOutline(pipeClampClaims, 3)).toMatchSnapshot();
	});

	it('a multiple dependency: each number of "claim 1 or 4" and "claims 4 to 6" after the removed claim moves down; earlier ones stay', () => {
		const claims = [
			'1. A hinge comprising a housing and a lever.',
			'2. The hinge according to claim 1, wherein the lever is steel.',
			'3. The hinge according to claim 1, wherein the housing is cast.',
			'4. The hinge according to claim 1 or 3, further comprising a spring.',
			'   <!-- src: feature:F4 -->',
			'5. The hinge according to claim 4, wherein the spring is coiled.',
			'6. The hinge as claimed in any one of claims 4 to 5, comprising a pin.',
			'7. Use of the hinge according to claims 1, 4 or 6 in a door.',
			'',
		].join('\n');
		expect(removalOutline(claims, 2)).toMatchSnapshot();
	});

	it('removing the claim that claim 9 depends on refuses and names claim 9 (PRD 0025, S5)', () => {
		const parents = parseClaims(pipeClampClaims).find(claim => claim.number === 9)?.dependsOn ?? [];
		const removal = removeClaim(pipeClampClaims, parents[0]);
		expect({ parents, removal, namesClaim9: !removal.removed && removal.reason === 'dependents' && removal.dependents.includes(9) }).toEqual({
			parents: [1],
			removal: { removed: false, reason: 'dependents', dependents: [2, 4, 5, 7, 8, 9, 11] },
			namesClaim9: true,
		});
	});

	it('refuses a claim another claim refers to, naming them, and a number with no claim', () => {
		expect([removeClaim(pipeClampClaims, 1), removeClaim(pipeClampClaims, 9), removeClaim(pipeClampClaims, 15)]).toEqual([
			{ removed: false, reason: 'dependents', dependents: [2, 4, 5, 7, 8, 9, 11] },
			{ removed: false, reason: 'dependents', dependents: [10] },
			{ removed: false, reason: 'no-claim' },
		]);
	});
});
