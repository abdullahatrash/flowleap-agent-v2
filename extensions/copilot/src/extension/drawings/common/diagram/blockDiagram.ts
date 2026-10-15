/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftFinding } from '../../../tools/common/drafting/finding';
import { DiagramResult, refuse, renderGraph } from './diagram';
import { boxSize, DiagramEdge, DiagramNode } from './diagramLayout';
import { countWords, DiagramNumeralScheme, DiagramOffice, keywordLabel, numeralFor, shortSentence, US_MAX_WORDS, wrapText } from './diagramText';

/** The most characters of one text line in a block. */
const BLOCK_LINE_CHARS = 24;

/** One block of a block diagram, in numeral order. */
export interface DiagramBlock {
	readonly id: string;
	readonly label: string;
}

/**
 * A named connection between two blocks. `direction` sets the arrowheads: `forward` (the
 * default) points at `to`, `backward` at `from`, `both` at both ends, `none` at neither.
 */
export interface DiagramConnection {
	readonly from: string;
	readonly to: string;
	readonly label?: string;
	readonly direction?: 'forward' | 'backward' | 'both' | 'none';
}

/** What a block-diagram Figure is made from. */
export interface BlockDiagramInput {
	readonly office: DiagramOffice;
	readonly scheme: DiagramNumeralScheme;
	readonly figure: number;
	readonly blocks: readonly DiagramBlock[];
	readonly connections: readonly DiagramConnection[];
}

/**
 * Draws a block-diagram Figure: one numbered block per given block, in order, joined by the
 * given connections with orthogonal lines and arrowheads. A connection that names an unknown
 * block refuses the Figure with the reason and no SVG.
 */
export async function drawBlockDiagram(input: BlockDiagramInput): Promise<DiagramResult> {
	const file = `FIG-${input.figure}.svg`;
	const refusals: DraftFinding[] = [];
	const findings: DraftFinding[] = [];
	const ids = new Set<string>();
	if (input.blocks.length === 0) {
		refusals.push({ severity: 'Error', rule: 'no-blocks', file, message: 'The block list is empty.' });
	}
	if (input.scheme === 'hundreds' && 2 * input.blocks.length >= 100) {
		refusals.push({ severity: 'Error', rule: 'numeral-range', file, message: `${input.blocks.length} blocks do not fit the ${input.figure}02-${input.figure}98 series of FIG. ${input.figure}.` });
	}
	for (const block of input.blocks) {
		if (ids.has(block.id)) {
			refusals.push({ severity: 'Error', rule: 'duplicate-node', file, message: `The block id "${block.id}" is used twice.` });
		}
		ids.add(block.id);
	}
	for (const connection of input.connections) {
		for (const end of [connection.from, connection.to]) {
			if (!ids.has(end)) {
				refusals.push({ severity: 'Error', rule: 'unknown-node', file, message: `The connection ${connection.from} -> ${connection.to} names "${end}", which is not a block of FIG. ${input.figure}.` });
			}
		}
	}
	if (refusals.length > 0) {
		return refuse(refusals);
	}

	const items = input.blocks.map((block, index) => {
		const numeral = numeralFor(input.scheme, input.figure, index);
		let text = block.label.trim();
		if (input.office === 'US' && countWords(text) > US_MAX_WORDS) {
			text = keywordLabel(text);
			findings.push({ severity: 'Note', rule: 'us-keywords-only', file, message: `The label of block ${block.id} (${numeral}) was cut to the keywords "${text}". A US drawing takes legends with "as few words as possible" (37 CFR 1.84(o); MPEP 608.02).` });
		} else if (input.office === 'EPO') {
			const sentence = shortSentence(text);
			text = sentence.text;
			if (sentence.truncated) {
				findings.push({ severity: 'Note', rule: 'epo-short-sentence', file, message: `The label of block ${block.id} (${numeral}) was cut to 12 words. Drawings carry only indispensable keywords (OJ EPO 2025 A49 Art. 1(2)(j)).` });
			}
		}
		if (!text) {
			findings.push(input.office === 'US'
				? { severity: 'Error', rule: 'mpep-608.02-unlabeled-box', file, message: `Block ${block.id} (${numeral}) has no label. The USPTO objects to "unlabeled rectangular box(es)", which "should be provided with descriptive text labels" (MPEP 608.02, form paragraph 6.22).` }
				: { severity: 'Error', rule: 'epo-empty-block', file, message: `Block ${block.id} (${numeral}) has no label. A block schematic carries a few short catchwords indispensable for understanding (PCT Rule 11.11).` });
		}
		return { block, numeral, lines: wrapText(text, BLOCK_LINE_CHARS) };
	});
	const uniform = items.reduce((size, item) => {
		const box = boxSize(item.lines);
		return { width: Math.max(size.width, box.width), height: Math.max(size.height, box.height) };
	}, { width: 0, height: 0 });
	const nodes: DiagramNode[] = items.map(item => ({ id: item.block.id, kind: 'block', lines: item.lines, numeral: item.numeral, width: uniform.width, height: uniform.height }));
	const edges: DiagramEdge[] = input.connections.map((connection, index) => {
		const direction = connection.direction ?? 'forward';
		return {
			id: `c${index + 1}`,
			from: connection.from,
			to: connection.to,
			label: connection.label,
			arrowStart: direction === 'backward' || direction === 'both',
			arrowEnd: direction === 'forward' || direction === 'both',
		};
	});

	return renderGraph({ kind: 'block', figure: input.figure, nodes, edges }, input.office, findings);
}
