/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The files of the Drawing Set tools in `drafting/<matter>/drawings/` (PRD 0023, slice D5):
 *
 * ```
 * drawings/
 *   FIG-1.scene.json         source of a Figure: the 3D scene, or for a 2D Figure the diagram input
 *   FIG-1.svg                the line art render_figure writes
 *   rounds.json              the review rounds per Figure, and whether the model saw the render
 *   review/FIG-1.round-2.png the review render of a round, never a deliverable
 * ```
 *
 * This module imports no kernel and no layout engine.
 */

import { DRAWING_RULES, DrawingRule } from '../../drawings/common/scene/drawingFaults';
import type { BlockDiagramInput } from '../../drawings/common/diagram/blockDiagram';
import type { FlowchartInput } from '../../drawings/common/diagram/flowchart';
import type { FigureReviewRecord } from '../../drawings/common/sheets/receipt';
import { DraftFinding } from '../common/drafting/finding';

/** Three review rounds per Figure (PRD 0023, D5 guardrail). */
export const MAX_REVIEW_ROUNDS = 3;

/** The file that records the review rounds, in `drawings/`. */
export const ROUNDS_FILE = 'rounds.json';

/** One Figure: its number, an optional partial-view letter, and the key `1` or `1A`. */
export interface FigureId {
	readonly number: number;
	readonly partial?: string;
	readonly key: string;
}

/** Reads the Figure number and the partial-view letter, or returns the reason they are not valid. */
export function figureId(number: number, partial?: string): FigureId | string {
	if (!Number.isInteger(number) || number < 1) {
		return `The figure number must be a positive integer, not ${number}.`;
	}
	const letter = partial?.trim().toUpperCase();
	if (letter && !/^[A-Z]$/.test(letter)) {
		return `A partial view takes one capital letter (FIG. ${number}A), not "${partial}" (37 CFR 1.84(u)(1)).`;
	}
	return letter ? { number, partial: letter, key: `${number}${letter}` } : { number, key: String(number) };
}

/** The Figure of a `FIG-N.svg` file name, or `undefined` for any other file. */
export function figureOfSvgFile(name: string): FigureId | undefined {
	const match = /^FIG-(?<number>[1-9]\d*)(?<partial>[A-Z])?\.svg$/.exec(name);
	if (!match?.groups) {
		return undefined;
	}
	const number = Number(match.groups.number);
	const partial = match.groups.partial;
	return partial ? { number, partial, key: `${number}${partial}` } : { number, key: String(number) };
}

/** The source file of a 2D Figure: the diagram input the Figure was drawn from. */
export type DiagramSource =
	| { readonly figure: string; readonly mode: 'flowchart'; readonly input: FlowchartInput }
	| { readonly figure: string; readonly mode: 'block'; readonly input: BlockDiagramInput };

/**
 * The SVG checks of a 2D Figure. The diagram writer checks its own labels per office (a flowchart
 * box may carry a sentence) and has no parts, so the keyword and on-part checks do not apply.
 */
export const DIAGRAM_SVG_CHECKS: readonly DrawingRule[] = (Object.keys(DRAWING_RULES) as DrawingRule[]).filter(rule => rule !== 'text-beyond-keywords' && rule !== 'lead-line-off-part');

/** One review round of a Figure. `seen` is false when the model got the findings only. */
export interface ReviewRound {
	readonly round: number;
	/** The review render, relative to `drawings/`. */
	readonly png: string;
	readonly seen: boolean;
}

/** The review rounds per Figure key. */
export type ReviewRounds = Readonly<Record<string, readonly ReviewRound[]>>;

interface RoundsFileShape {
	readonly figures?: Record<string, readonly Partial<ReviewRound>[]>;
}

/** Reads `rounds.json`; a missing or broken file gives no rounds. */
export function parseReviewRounds(text: string | undefined): ReviewRounds {
	if (!text) {
		return {};
	}
	let parsed: RoundsFileShape;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {};
	}
	const result: Record<string, ReviewRound[]> = {};
	for (const [key, rounds] of Object.entries(parsed?.figures ?? {})) {
		if (Array.isArray(rounds)) {
			result[key] = rounds
				.filter(round => typeof round.round === 'number' && typeof round.png === 'string')
				.map(round => ({ round: round.round!, png: round.png!, seen: round.seen !== false }));
		}
	}
	return result;
}

/** Writes `rounds.json`. */
export function renderReviewRounds(rounds: ReviewRounds): string {
	const figures = Object.fromEntries(Object.keys(rounds).sort().map(key => [key, rounds[key]]));
	return `${JSON.stringify({ figures }, null, '\t')}\n`;
}

/** The review records of the receipt: per Figure, the rounds whose render the model saw. */
export function reviewRecords(rounds: ReviewRounds, keys: readonly string[]): FigureReviewRecord[] {
	return keys.map(figure => ({ figure, rounds: (rounds[figure] ?? []).filter(round => round.seen).map(round => ({ round: round.round, png: round.png })) }));
}

/** One line per Figure finding, with its rule citation when it has one. */
export function drawingFindingLine(finding: DraftFinding & { readonly citation?: string }): string {
	const location = [finding.file, finding.line !== undefined ? `line ${finding.line}` : undefined].filter(Boolean).join(', ');
	return `- ${finding.severity} \`${finding.rule}\`${location ? ` (${location})` : ''}: ${finding.message.replace(/\s*\n\s*/g, ' ')}${finding.citation ? ` [${finding.citation}]` : ''}`;
}
