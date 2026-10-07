/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseClaims } from '../drafting/claims';

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
