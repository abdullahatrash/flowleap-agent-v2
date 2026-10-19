/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DrawingFinding } from '../../common/scene/drawingFaults';
import { isObject, JsonObject, SCHEMA_CITATION } from '../../common/scene/sceneValidator';
import type { BlockRequest, FlowchartRequest } from './renderFigureOp';

/** The typed request when there is no Error, and the Findings in document order. */
export interface RequestValidation<T> {
	readonly request?: T;
	readonly findings: DrawingFinding[];
}

const NODE_KINDS = ['decision', 'process'] as const;
const DIRECTIONS = ['forward', 'backward', 'both', 'none'] as const;

/** The structural checks of a request, each adding a `scene-schema` Error for the source file of the Figure. */
function requestChecks(figure: string, findings: DrawingFinding[]) {
	const file = `FIG-${figure}.scene.json`;
	const error = (path: string, message: string) => {
		findings.push({ severity: 'Error', rule: 'scene-schema', message: `${path}: ${message}`, citation: SCHEMA_CITATION, file });
	};
	const text = (value: unknown, path: string, optional = false) => {
		if (optional && value === undefined) {
			return;
		}
		if (typeof value !== 'string' || !value.trim()) {
			error(path, 'must be a non-empty string');
		}
	};
	const oneOf = (value: unknown, choices: readonly string[], path: string, optional = false) => {
		if (optional && value === undefined) {
			return;
		}
		if (typeof value !== 'string' || !choices.includes(value)) {
			error(path, `must be one of ${choices.join(', ')}`);
		}
	};
	const objects = (value: unknown, path: string, shape: string, check: (item: JsonObject, itemPath: string) => void, optional = false) => {
		if (optional && value === undefined) {
			return;
		}
		if (!Array.isArray(value)) {
			error(path, `must be an array of ${shape}`);
			return;
		}
		value.forEach((item, index) => {
			const itemPath = `${path}[${index}]`;
			if (!isObject(item)) {
				error(itemPath, `must be ${shape}`);
				return;
			}
			check(item, itemPath);
		});
	};
	return { error, text, oneOf, objects };
}

/**
 * Validates a flowchart request read from raw JSON (the CLI `--flowchart` file): `steps` is an
 * array of step texts, `fromClaim` a claim number, `terminals` a boolean, and `proposal` holds
 * decision nodes and extra edges. Which of `steps` and `fromClaim` the request needs is the
 * render's own rule. Refusal text in the style of the scene validator.
 */
export function validateFlowchartRequest(input: unknown, figure: string): RequestValidation<FlowchartRequest> {
	const findings: DrawingFinding[] = [];
	const { error, text, oneOf, objects } = requestChecks(figure, findings);
	if (!isObject(input)) {
		error('flowchart', 'must be an object with "steps" or "fromClaim"');
		return { findings };
	}
	if (input.steps !== undefined) {
		if (!Array.isArray(input.steps)) {
			error('steps', 'must be an array of step texts');
		} else {
			input.steps.forEach((step, index) => text(step, `steps[${index}]`));
		}
	}
	if (input.fromClaim !== undefined && (typeof input.fromClaim !== 'number' || !Number.isInteger(input.fromClaim) || input.fromClaim < 1)) {
		error('fromClaim', 'must be a claim number');
	}
	if (input.terminals !== undefined && typeof input.terminals !== 'boolean') {
		error('terminals', 'must be true or false');
	}
	if (input.proposal !== undefined) {
		if (!isObject(input.proposal)) {
			error('proposal', 'must be an object with "nodes" and/or "edges"');
		} else {
			objects(input.proposal.nodes, 'proposal.nodes', '{ id, kind, text, after?, continueLabel? }', (node, path) => {
				text(node.id, `${path}.id`);
				oneOf(node.kind, NODE_KINDS, `${path}.kind`);
				text(node.text, `${path}.text`);
				text(node.after, `${path}.after`, true);
				text(node.continueLabel, `${path}.continueLabel`, true);
			}, true);
			objects(input.proposal.edges, 'proposal.edges', '{ from, to, label? }', (edge, path) => {
				text(edge.from, `${path}.from`);
				text(edge.to, `${path}.to`);
				text(edge.label, `${path}.label`, true);
			}, true);
		}
	}
	return findings.length === 0 ? { request: input as unknown as FlowchartRequest, findings } : { findings };
}

/**
 * Validates a block-diagram request read from raw JSON (the CLI `--block` file): `blocks` is an
 * array of `{ id, label }`, `connections` an array of `{ from, to, label?, direction? }`.
 */
export function validateBlockRequest(input: unknown, figure: string): RequestValidation<BlockRequest> {
	const findings: DrawingFinding[] = [];
	const { error, text, oneOf, objects } = requestChecks(figure, findings);
	if (!isObject(input)) {
		error('block', 'must be an object with "blocks"');
		return { findings };
	}
	objects(input.blocks, 'blocks', '{ id, label }', (block, path) => {
		text(block.id, `${path}.id`);
		text(block.label, `${path}.label`);
	});
	objects(input.connections, 'connections', '{ from, to, label?, direction? }', (connection, path) => {
		text(connection.from, `${path}.from`);
		text(connection.to, `${path}.to`);
		text(connection.label, `${path}.label`, true);
		oneOf(connection.direction, DIRECTIONS, `${path}.direction`, true);
	}, true);
	return findings.length === 0 ? { request: input as unknown as BlockRequest, findings } : { findings };
}
