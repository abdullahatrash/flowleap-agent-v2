/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cleanStepText } from './diagramText';

/** One method step, in claim order. The step list is the authority for the process boxes. */
export interface DiagramStep {
	readonly id: string;
	readonly text: string;
}

/**
 * Splits an approved method claim into its steps, in order, deterministically.
 *
 * The preamble ends at the first `:` (or after `comprising` when there is no colon). Lettered
 * or numbered markers `(a) (b) ...` split the body when they run in sequence; else `;` and
 * `; and` split it. Step ids are `s1`, `s2`, ...; the step text loses its marker and its
 * trailing `; and` or period.
 */
export function stepsFromMethodClaim(claimText: string): DiagramStep[] {
	const text = claimText.replace(/\s+/g, ' ').trim().replace(/^\d+\s*\.\s*/, '');
	const colon = text.indexOf(':');
	const comprising = /\b(?:comprising|consisting of|including)(?: the steps of)?\b/i.exec(text);
	const body = colon >= 0
		? text.slice(colon + 1)
		: comprising ? text.slice(comprising.index + comprising[0].length) : text;
	const parts = splitOnMarkers(body) ?? body.split(/;/);
	return parts
		.map(part => cleanStepText(part.replace(/^\s*and\s+/i, '')))
		.filter(part => part.length > 0)
		.map((part, index) => ({ id: `s${index + 1}`, text: part }));
}

/** Splits on `(a) (b) ...` or `(1) (2) ...` markers that run in sequence, or undefined if there are fewer than two. */
function splitOnMarkers(body: string): string[] | undefined {
	const markers = [...body.matchAll(/(?:^|\s)\((?<marker>[a-z]|\d+)\)\s/gi)];
	const first = markers[0]?.groups?.marker;
	if (!first) {
		return undefined;
	}
	const lettered = /[a-z]/i.test(first);
	const label = (index: number) => lettered ? String.fromCharCode(first.toLowerCase().charCodeAt(0) + index) : String(Number(first) + index);
	const starts: number[] = [];
	for (const match of markers) {
		if (match.groups?.marker.toLowerCase() === label(starts.length)) {
			starts.push(match.index);
		}
	}
	if (starts.length < 2) {
		return undefined;
	}
	return starts.map((start, index) => body.slice(start, starts[index + 1] ?? body.length));
}
