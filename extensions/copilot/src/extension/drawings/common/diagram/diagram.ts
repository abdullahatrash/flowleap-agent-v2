/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftFinding, errorsFirst } from '../../../tools/common/drafting/finding';
import { checkDiagramSvg } from './diagramFaults';
import { DiagramGraph, layoutDiagram } from './diagramLayout';
import { writeDiagramSvg } from './diagramSvg';
import { DiagramOffice } from './diagramText';

/**
 * The result of a 2D Figure: the `FIG-N.svg` text, or no SVG when the input is refused, and
 * the Findings. A refusal is an Error Finding that gives the reason.
 */
export interface DiagramResult {
	readonly svg: string | undefined;
	readonly findings: readonly DraftFinding[];
}

/** A refused diagram: no SVG, the reasons as Findings. */
export function refuse(findings: readonly DraftFinding[]): DiagramResult {
	return { svg: undefined, findings: errorsFirst(findings) };
}

/** Lays out the graph, writes the SVG, and adds the fault check of the written SVG to the Findings. */
export async function renderGraph(graph: DiagramGraph, office: DiagramOffice, findings: readonly DraftFinding[]): Promise<DiagramResult> {
	const svg = writeDiagramSvg(await layoutDiagram(graph));
	const numerals = graph.nodes.flatMap(node => node.numeral === undefined ? [] : [node.numeral]);
	return { svg, findings: errorsFirst([...findings, ...checkDiagramSvg(svg, { office, figure: graph.figure, numerals })]) };
}
