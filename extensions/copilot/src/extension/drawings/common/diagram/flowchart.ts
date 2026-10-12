/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftFinding } from '../../../tools/common/drafting/finding';
import { DiagramResult, refuse, renderGraph } from './diagram';
import { boxSize, DiagramEdge, DiagramNode } from './diagramLayout';
import { DiagramNumeralScheme, DiagramOffice, keywordLabel, numeralFor, shortSentence, wrapText } from './diagramText';
import { DiagramStep } from './steps';

/** The ids of the optional START and END terminals. */
const START = 'start';
const END = 'end';
/** The most characters of one text line in a process box or a diamond. */
const BOX_LINE_CHARS = 24;
const DIAMOND_LINE_CHARS = 18;

/**
 * A node the model proposes. Only `decision` nodes are allowed: a diamond inserted in the
 * chain after the step `after`. A proposed `process` node is an invented step and refuses the
 * Figure.
 */
export interface ProposedNode {
	readonly id: string;
	readonly kind: 'decision' | 'process';
	readonly text: string;
	/** The step (or decision) after which a decision sits in the chain. */
	readonly after?: string;
	/** The label of the chain edge that leaves the decision; `Yes` when not given. */
	readonly continueLabel?: string;
}

/** An extra edge the model proposes: a branch or a loop. */
export interface ProposedEdge {
	readonly from: string;
	readonly to: string;
	readonly label?: string;
}

/** The model's proposal for a flowchart. It may add decisions and edges, never steps. */
export interface FlowchartProposal {
	readonly nodes?: readonly ProposedNode[];
	readonly edges?: readonly ProposedEdge[];
}

/** What a flowchart Figure is made from. */
export interface FlowchartInput {
	readonly office: DiagramOffice;
	readonly scheme: DiagramNumeralScheme;
	readonly figure: number;
	/** The ordered steps; the authority for the process boxes (ADR 0014). */
	readonly steps: readonly DiagramStep[];
	/** Draws START and END terminals; off by default. */
	readonly terminals?: boolean;
	readonly proposal?: FlowchartProposal;
}

/**
 * Draws a flowchart Figure: exactly one process box per step, in step order, numbered by the
 * scheme, chained top to bottom. The proposal may add decision diamonds and edges only. A
 * process-box count other than the step count, or a proposal that names an unknown node, is
 * refused with the reason and no SVG.
 */
export async function drawFlowchart(input: FlowchartInput): Promise<DiagramResult> {
	const file = `FIG-${input.figure}.svg`;
	const refusals: DraftFinding[] = [];
	const findings: DraftFinding[] = [];
	const proposedNodes = input.proposal?.nodes ?? [];
	const proposedEdges = input.proposal?.edges ?? [];

	if (input.steps.length === 0) {
		refusals.push({ severity: 'Error', rule: 'no-steps', file, message: 'The step list is empty. A flowchart takes one box per method step (ADR 0014).' });
	}
	if (input.scheme === 'hundreds' && 2 * input.steps.length >= 100) {
		refusals.push({ severity: 'Error', rule: 'numeral-range', file, message: `${input.steps.length} steps do not fit the ${input.figure}02-${input.figure}98 series of FIG. ${input.figure}.` });
	}
	const processCount = input.steps.length + proposedNodes.filter(node => node.kind === 'process').length;
	if (processCount !== input.steps.length) {
		refusals.push({ severity: 'Error', rule: 'node-count', file, message: `FIG. ${input.figure} would have ${processCount} process boxes for ${input.steps.length} steps. The step list is the authority: a proposal may add decisions and edges only, never a step (ADR 0014).` });
	}

	const ids = new Set<string>();
	const addId = (id: string) => {
		if (ids.has(id) || (id === START || id === END)) {
			refusals.push({ severity: 'Error', rule: 'duplicate-node', file, message: `The node id "${id}" is used twice or is reserved for a terminal.` });
		}
		ids.add(id);
	};
	input.steps.forEach(step => addId(step.id));
	const decisions = proposedNodes.filter(node => node.kind === 'decision');
	decisions.forEach(node => addId(node.id));
	if (input.terminals) {
		ids.add(START);
		ids.add(END);
	}
	for (const node of decisions) {
		if (!node.after || !ids.has(node.after) || node.after === END) {
			refusals.push({ severity: 'Error', rule: 'unknown-node', file, message: `The decision "${node.id}" sits after "${node.after ?? ''}", which is not a node of FIG. ${input.figure}.` });
		}
	}
	for (const edge of proposedEdges) {
		for (const end of [edge.from, edge.to]) {
			if (!ids.has(end)) {
				refusals.push({ severity: 'Error', rule: 'unknown-node', file, message: `The proposed edge ${edge.from} -> ${edge.to} names "${end}", which is not a node of FIG. ${input.figure}. A proposal may only connect the steps and its own decisions.` });
			}
		}
		if (edge.to === START || edge.from === END) {
			refusals.push({ severity: 'Error', rule: 'terminal-edge', file, message: `The proposed edge ${edge.from} -> ${edge.to} enters START or leaves END.` });
		}
	}
	if (refusals.length > 0) {
		return refuse(refusals);
	}

	// One process box per step, uniform in size.
	const stepLines = input.steps.map((step, index) => {
		const numeral = numeralFor(input.scheme, input.figure, index);
		let text: string;
		if (input.office === 'US') {
			text = keywordLabel(step.text);
			if (!text) {
				findings.push({ severity: 'Error', rule: 'mpep-608.02-unlabeled-box', file, message: `The box of step ${step.id} (${numeral}) has no label. The USPTO objects to "unlabeled rectangular box(es)", which "should be provided with descriptive text labels" (MPEP 608.02, form paragraph 6.22).` });
			}
		} else {
			const sentence = shortSentence(step.text);
			text = sentence.text;
			if (!text) {
				findings.push({ severity: 'Error', rule: 'epo-empty-step', file, message: `The box of step ${step.id} (${numeral}) has no text. The EPO allows a short sentence for each method step (Guidelines A-IX 8).` });
			}
			if (sentence.truncated) {
				findings.push({ severity: 'Note', rule: 'epo-short-sentence', file, message: `The text of step ${step.id} (${numeral}) was cut to 12 words. The EPO allows a short sentence per method step (Guidelines A-IX 8); put the full step in the description.` });
			}
		}
		return { step, numeral, lines: wrapText(text, BOX_LINE_CHARS) };
	});
	const uniform = stepLines.reduce((size, item) => {
		const box = boxSize(item.lines);
		return { width: Math.max(size.width, box.width), height: Math.max(size.height, box.height) };
	}, { width: 0, height: 0 });

	const nodes: DiagramNode[] = [];
	const terminal = (id: string, text: string): DiagramNode => ({ id, kind: 'terminal', lines: [text], ...boxSize([text], 22) });
	if (input.terminals) {
		nodes.push(terminal(START, 'START'));
	}
	for (const item of stepLines) {
		nodes.push({ id: item.step.id, kind: 'process', lines: item.lines, numeral: item.numeral, width: uniform.width, height: uniform.height });
	}
	for (const node of decisions) {
		const text = input.office === 'US' ? keywordLabel(node.text) : shortSentence(node.text).text;
		const lines = wrapText(text, DIAMOND_LINE_CHARS);
		const inner = boxSize(lines);
		nodes.push({ id: node.id, kind: 'decision', lines, width: inner.width * 2, height: inner.height * 2 });
	}
	if (input.terminals) {
		nodes.push(terminal(END, 'END'));
	}

	// The default chain: START, each step followed by its decisions, END.
	const chain: string[] = input.terminals ? [START] : [];
	const placeAfter = (id: string) => {
		if (chain.includes(id)) {
			return;
		}
		chain.push(id);
		for (const node of decisions.filter(candidate => candidate.after === id)) {
			placeAfter(node.id);
		}
	};
	if (input.terminals) {
		decisions.filter(node => node.after === START).forEach(node => placeAfter(node.id));
	}
	input.steps.forEach(step => placeAfter(step.id));
	if (input.terminals) {
		chain.push(END);
	}
	const unplaced = decisions.filter(node => !chain.includes(node.id));
	if (unplaced.length > 0) {
		return refuse(unplaced.map(node => ({ severity: 'Error', rule: 'unknown-node', file, message: `The decision "${node.id}" is not reachable from the step chain of FIG. ${input.figure}.` })));
	}
	const continueLabel = new Map(decisions.map(node => [node.id, node.continueLabel ?? 'Yes']));
	const edges: DiagramEdge[] = [];
	const has = (from: string, to: string) => edges.some(edge => edge.from === from && edge.to === to);
	for (let i = 0; i + 1 < chain.length; i++) {
		edges.push({ id: `e${edges.length + 1}`, from: chain[i], to: chain[i + 1], label: continueLabel.get(chain[i]), arrowStart: false, arrowEnd: true });
	}
	for (const edge of proposedEdges) {
		if (!has(edge.from, edge.to)) {
			edges.push({ id: `e${edges.length + 1}`, from: edge.from, to: edge.to, label: edge.label, arrowStart: false, arrowEnd: true });
		}
	}
	for (const node of decisions) {
		if (edges.filter(edge => edge.from === node.id).length < 2) {
			findings.push({ severity: 'Note', rule: 'decision-branch', file, message: `The decision "${node.id}" has fewer than two outgoing edges.` });
		}
	}

	// Model order = chain order, so the layered cycle breaking reverses only the loops.
	const ordered = chain.map(id => nodes.find(node => node.id === id)).filter((node): node is DiagramNode => node !== undefined);
	return renderGraph({ kind: 'flowchart', figure: input.figure, nodes: ordered, edges }, input.office, findings);
}
