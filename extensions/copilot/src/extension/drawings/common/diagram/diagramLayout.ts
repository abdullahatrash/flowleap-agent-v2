/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ElkConstructor, { type ELK, type ElkExtendedEdge, type ElkNode, type ElkPort, type LayoutOptions } from 'elkjs/lib/elk.bundled.js';
import { CHAR_WIDTH, FONT_SIZE, LINE_HEIGHT, NUMERAL_FONT_SIZE, textWidth } from './diagramText';

/** The shape of a diagram node. */
export type DiagramNodeKind = 'process' | 'decision' | 'terminal' | 'block';

/** A node before layout: its text lines and its box size in mm. */
export interface DiagramNode {
	readonly id: string;
	readonly kind: DiagramNodeKind;
	readonly lines: readonly string[];
	readonly numeral?: number;
	readonly width: number;
	readonly height: number;
}

/** A connection before layout. */
export interface DiagramEdge {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly label?: string;
	readonly arrowStart: boolean;
	readonly arrowEnd: boolean;
}

/** A diagram before layout. */
export interface DiagramGraph {
	readonly kind: 'flowchart' | 'block';
	readonly figure: number;
	readonly nodes: readonly DiagramNode[];
	readonly edges: readonly DiagramEdge[];
}

/** A point in mm. */
export interface Point {
	readonly x: number;
	readonly y: number;
}

/** A node after layout; `x`, `y` is the top-left corner of its box. */
export interface PlacedNode extends DiagramNode {
	readonly x: number;
	readonly y: number;
	/** The baseline middle of the numeral (`text-anchor="middle"`), when the node has one. */
	readonly numeralAt?: Point;
}

/** A connection after layout. */
export interface PlacedEdge extends DiagramEdge {
	readonly points: readonly Point[];
	/** The centre of the edge label, when the edge has one. */
	readonly labelAt?: Point;
}

/** A diagram after layout. */
export interface PlacedDiagram {
	readonly kind: 'flowchart' | 'block';
	readonly figure: number;
	readonly nodes: readonly PlacedNode[];
	readonly edges: readonly PlacedEdge[];
}

/** The gap in mm between a box and its numeral; the lead line spans it. */
const NUMERAL_GAP = 4;

/** The fixed options of the layered algorithm; a fixed seed keeps the layout the same on every run. */
const ROOT_OPTIONS: LayoutOptions = {
	'elk.algorithm': 'layered',
	'elk.direction': 'DOWN',
	'elk.edgeRouting': 'ORTHOGONAL',
	'elk.randomSeed': '1',
	'elk.padding': '[top=0,left=0,bottom=0,right=0]',
	'elk.spacing.nodeNode': '10',
	'elk.spacing.edgeNode': '4',
	'elk.spacing.edgeEdge': '3',
	'elk.spacing.edgeLabel': '1',
	'elk.spacing.labelNode': String(NUMERAL_GAP),
	'elk.layered.spacing.nodeNodeBetweenLayers': '9',
	'elk.layered.spacing.edgeNodeBetweenLayers': '4',
	'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
	'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
	'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
};

let elk: ELK | undefined;

/** Lays out the graph top-down with the layered algorithm of ELK. */
export async function layoutDiagram(graph: DiagramGraph): Promise<PlacedDiagram> {
	elk ??= new ElkConstructor();
	const decisionPorts = new Map<string, string[]>();
	const children: ElkNode[] = graph.nodes.map(node => {
		const labels = node.numeral === undefined ? undefined : [{
			id: `${node.id}.numeral`,
			text: String(node.numeral),
			width: textWidth(String(node.numeral), NUMERAL_FONT_SIZE),
			height: NUMERAL_FONT_SIZE,
			layoutOptions: { 'elk.nodeLabels.placement': 'OUTSIDE V_CENTER H_RIGHT' },
		}];
		if (node.kind !== 'decision') {
			return { id: node.id, width: node.width, height: node.height, labels };
		}
		// A diamond touches its box only at the side midpoints: the edges must end there.
		const port = (side: string, x: number, y: number): ElkPort => ({ id: `${node.id}.${side}`, x, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } });
		const ports = [
			port('NORTH', node.width / 2, 0),
			port('SOUTH', node.width / 2, node.height),
			port('EAST', node.width, node.height / 2),
			port('WEST', 0, node.height / 2),
		];
		decisionPorts.set(node.id, ports.map(p => p.id));
		return { id: node.id, width: node.width, height: node.height, ports, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } };
	});

	// Into a diamond at the top; out of it at the bottom first, then right, then left.
	const outCount = new Map<string, number>();
	const source = (id: string) => {
		const ports = decisionPorts.get(id);
		if (!ports) {
			return id;
		}
		const used = outCount.get(id) ?? 0;
		outCount.set(id, used + 1);
		return ports[[1, 2, 3][Math.min(used, 2)]];
	};
	const target = (id: string) => decisionPorts.get(id)?.[0] ?? id;
	const edges: ElkExtendedEdge[] = graph.edges.map(edge => ({
		id: edge.id,
		sources: [source(edge.from)],
		targets: [target(edge.to)],
		labels: edge.label === undefined ? undefined : [{
			id: `${edge.id}.label`,
			text: edge.label,
			width: textWidth(edge.label) + 1,
			height: FONT_SIZE + 1,
			layoutOptions: { 'elk.edgeLabels.placement': decisionPorts.has(edge.from) ? 'TAIL' : 'CENTER' },
		}],
	}));

	const result = await elk.layout({ id: 'root', layoutOptions: ROOT_OPTIONS, children, edges });
	const placed = new Map((result.children ?? []).map(child => [child.id, child]));
	const placedEdges = new Map((result.edges ?? []).map(edge => [edge.id, edge]));

	return {
		kind: graph.kind,
		figure: graph.figure,
		nodes: graph.nodes.map(node => {
			const child = placed.get(node.id);
			const x = child?.x ?? 0;
			const y = child?.y ?? 0;
			const label = child?.labels?.[0];
			const numeralWidth = textWidth(String(node.numeral), NUMERAL_FONT_SIZE);
			const numeralAt = node.numeral === undefined ? undefined : {
				x: x + (label?.x ?? node.width + NUMERAL_GAP) + numeralWidth / 2,
				y: y + (label?.y ?? (node.height - NUMERAL_FONT_SIZE) / 2) + NUMERAL_FONT_SIZE * 0.8,
			};
			return { ...node, x, y, numeralAt };
		}),
		edges: graph.edges.map(edge => {
			const section = placedEdges.get(edge.id)?.sections?.[0];
			const points = section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : [];
			const label = placedEdges.get(edge.id)?.labels?.[0];
			const labelAt = label && label.x !== undefined && label.y !== undefined
				? { x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 }
				: undefined;
			return { ...edge, points: points.map(p => ({ x: p.x, y: p.y })), labelAt };
		}),
	};
}

/** The box size in mm that holds `lines`, padded, at least `minWidth` wide. */
export function boxSize(lines: readonly string[], minWidth = 0): { width: number; height: number } {
	const chars = Math.max(0, ...lines.map(line => [...line].length));
	return {
		width: Math.max(minWidth, chars * CHAR_WIDTH + 6),
		height: Math.max(1, lines.length) * LINE_HEIGHT + 4,
	};
}
