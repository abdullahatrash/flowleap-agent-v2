/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { drawBlockDiagram } from '../blockDiagram';
import { checkDiagramSvg } from '../diagramFaults';
import { DiagramResult } from '../diagram';
import { drawFlowchart } from '../flowchart';
import { DiagramStep, stepsFromMethodClaim } from '../steps';

const windTurbineClaim = '1. A computer-implemented method for detecting a fault in a wind turbine, the method comprising: receiving, by a processor, vibration data from a sensor mounted on a gearbox of the wind turbine; transforming the vibration data into a frequency spectrum; comparing an amplitude of the frequency spectrum at a gear-mesh frequency with a threshold; storing the amplitude in a maintenance log of the wind turbine; and generating an alert when the amplitude exceeds the threshold.';

const tabletClaim = '1. A method of producing a coated tablet, comprising the steps of: (a) blending an active ingredient with a binder to form a granulate; (b) compressing the granulate into a tablet core; (c) spraying a film-coating suspension onto the tablet core in a rotating drum, wherein the suspension comprises hydroxypropyl methylcellulose; and (d) drying the coated tablet core at a temperature below 60 °C.';

const fiveSteps: DiagramStep[] = stepsFromMethodClaim(windTurbineClaim);

/** The rule ids of the Findings as a leading XML comment, then the SVG: the snapshot form of the 3D engine. */
function snapshotText(result: DiagramResult): string {
	return `<!-- findings: ${JSON.stringify(result.findings.map(finding => finding.rule))} -->\n${result.svg ?? ''}`;
}

describe('stepsFromMethodClaim', () => {
	it('splits a claim on semicolons', () => {
		expect(stepsFromMethodClaim(windTurbineClaim)).toEqual([
			{ id: 's1', text: 'receiving, by a processor, vibration data from a sensor mounted on a gearbox of the wind turbine' },
			{ id: 's2', text: 'transforming the vibration data into a frequency spectrum' },
			{ id: 's3', text: 'comparing an amplitude of the frequency spectrum at a gear-mesh frequency with a threshold' },
			{ id: 's4', text: 'storing the amplitude in a maintenance log of the wind turbine' },
			{ id: 's5', text: 'generating an alert when the amplitude exceeds the threshold' },
		]);
	});

	it('splits a claim on lettered steps', () => {
		expect(stepsFromMethodClaim(tabletClaim)).toEqual([
			{ id: 's1', text: 'blending an active ingredient with a binder to form a granulate' },
			{ id: 's2', text: 'compressing the granulate into a tablet core' },
			{ id: 's3', text: 'spraying a film-coating suspension onto the tablet core in a rotating drum, wherein the suspension comprises hydroxypropyl methylcellulose' },
			{ id: 's4', text: 'drying the coated tablet core at a temperature below 60 °C' },
		]);
	});
});

describe('drawFlowchart', () => {
	it('draws a linear five-step US flowchart with even numerals', async () => {
		const result = await drawFlowchart({ office: 'US', scheme: 'even', figure: 1, steps: fiveSteps, terminals: true });
		await expect(snapshotText(result)).toMatchFileSnapshot('./__snapshots__/flowchart-us-linear.svg');
	});

	it('draws the same flowchart for the EPO with FIG. 3 hundreds numerals', async () => {
		const result = await drawFlowchart({ office: 'EPO', scheme: 'hundreds', figure: 3, steps: fiveSteps, terminals: true });
		await expect(snapshotText(result)).toMatchFileSnapshot('./__snapshots__/flowchart-epo-linear.svg');
	});

	it('adds a proposed decision branch and loop', async () => {
		const result = await drawFlowchart({
			office: 'US', scheme: 'hundreds', figure: 2, steps: fiveSteps, terminals: true,
			proposal: {
				nodes: [{ id: 'd1', kind: 'decision', text: 'Amplitude exceeds threshold?', after: 's4' }],
				edges: [{ from: 'd1', to: 's1', label: 'No' }],
			},
		});
		await expect(snapshotText(result)).toMatchFileSnapshot('./__snapshots__/flowchart-us-branch-loop.svg');
	});

	it('refuses a proposal that invents a sixth process box for five steps', async () => {
		const result = await drawFlowchart({
			office: 'US', scheme: 'even', figure: 1, steps: fiveSteps,
			proposal: { nodes: [{ id: 's6', kind: 'process', text: 'calibrating the sensor', after: 's5' }] },
		});
		expect(result).toEqual({
			svg: undefined,
			findings: [{ severity: 'Error', rule: 'node-count', file: 'FIG-1.svg', message: 'FIG. 1 would have 6 process boxes for 5 steps. The step list is the authority: a proposal may add decisions and edges only, never a step (ADR 0014).' }],
		});
	});

	it('refuses a proposed edge to an unknown node', async () => {
		const result = await drawFlowchart({
			office: 'EPO', scheme: 'even', figure: 1, steps: fiveSteps,
			proposal: { edges: [{ from: 's5', to: 's9' }] },
		});
		expect(result).toEqual({
			svg: undefined,
			findings: [{ severity: 'Error', rule: 'unknown-node', file: 'FIG-1.svg', message: 'The proposed edge s5 -> s9 names "s9", which is not a node of FIG. 1. A proposal may only connect the steps and its own decisions.' }],
		});
	});

	it('names MPEP 608.02 for a US box without a label', async () => {
		const steps = [...fiveSteps.slice(0, 2), { id: 's3', text: '(c) …;' }, ...fiveSteps.slice(3)];
		const result = await drawFlowchart({ office: 'US', scheme: 'even', figure: 1, steps });
		expect({ svg: result.svg !== undefined, findings: result.findings }).toEqual({
			svg: true,
			findings: [{ severity: 'Error', rule: 'mpep-608.02-unlabeled-box', file: 'FIG-1.svg', message: 'The box of step s3 (6) has no label. The USPTO objects to "unlabeled rectangular box(es)", which "should be provided with descriptive text labels" (MPEP 608.02, form paragraph 6.22).' }],
		});
	});
});

describe('drawBlockDiagram', () => {
	it('draws a block diagram with four blocks', async () => {
		const result = await drawBlockDiagram({
			office: 'US', scheme: 'hundreds', figure: 4,
			blocks: [
				{ id: 'sensor', label: 'Vibration sensor' },
				{ id: 'processor', label: 'Processor' },
				{ id: 'memory', label: 'Memory' },
				{ id: 'display', label: 'Alert display' },
			],
			connections: [
				{ from: 'sensor', to: 'processor', label: 'Data' },
				{ from: 'processor', to: 'memory', direction: 'both' },
				{ from: 'processor', to: 'display', label: 'Alert' },
			],
		});
		await expect(snapshotText(result)).toMatchFileSnapshot('./__snapshots__/block-us-four.svg');
	});
});

describe('checkDiagramSvg', () => {
	it('names the faults of a bad US diagram', () => {
		const svg = [
			'<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40" data-figure="FIG-1" data-kind="flowchart">',
			'<rect width="80" height="40" fill="#fff"/>',
			'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">',
			'<path class="edge" data-role="connector" data-from="s1" data-to="s2" stroke-width="0.4" d="M40 2 L40 38"/>',
			'<path class="lead" data-numeral="2" stroke-width="0.2" d="M41.5 29 L30 29"/>',
			'</g>',
			'<text class="label" data-node="s1" x="20" y="10" font-size="3.5" font-family="sans-serif" text-anchor="middle" fill="#000">Receiving the vibration data from sensor</text>',
			'<text class="label" data-node="s2" x="22" y="11" font-size="3.5" font-family="sans-serif" text-anchor="middle" fill="#000">Alert</text>',
			'<text class="numeral" data-numeral="2" x="43" y="30" font-size="4.5" font-family="sans-serif" text-anchor="middle" fill="#000">2</text>',
			'<text class="numeral" data-numeral="12" x="60" y="30" font-size="4.5" font-family="sans-serif" text-anchor="middle" fill="#000">12</text>',
			'</svg>',
		].join('\n');
		expect(checkDiagramSvg(svg, { office: 'US', figure: 1, numerals: [2, 4] }).map(finding => finding.rule)).toEqual([
			'us-keywords-only', 'label-overlap', 'numeral-set', 'lead-crosses-edge', 'lead-line',
		]);
	});
});
