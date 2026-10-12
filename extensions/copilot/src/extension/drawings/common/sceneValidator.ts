/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DrawingFinding, NUMERAL_PATTERN } from './drawingFaults';
import { CAMERA_PRESETS, DrawingScene, LIBRARY_KINDS, PRIMITIVE_KINDS } from './drawingScene';

/** Options of the scene validator. */
export interface SceneValidationOptions {
	/**
	 * Allow parts of kind `code` (the per-part escape hatch). Off by default: a scene with a code part
	 * is refused unless the caller opts in.
	 */
	readonly allowCode?: boolean;
}

const SCHEMA_CITATION = 'ADR 0014 decision 1 (scene schema)';

type JsonObject = { readonly [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a parsed `FIG-N.scene.json`. Returns the typed scene when there is no Error, and the
 * Findings in document order. The checks are structural: kinds, numbers, ranges, unique part ids,
 * the code opt-in. Port references are checked by the mechanical fault list.
 */
export function validateScene(input: unknown, options: SceneValidationOptions = {}): { scene?: DrawingScene; findings: DrawingFinding[] } {
	const findings: DrawingFinding[] = [];
	const figure = isObject(input) && typeof input.figure === 'string' ? input.figure : 'FIG';
	const file = `${figure}.scene.json`;
	const error = (path: string, message: string, rule = 'scene-schema', citation = SCHEMA_CITATION) => {
		findings.push({ severity: 'Error', rule, message: `${path}: ${message}`, citation, file });
	};

	const positive = (value: unknown, path: string) => {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
			error(path, 'must be a positive number');
		}
	};
	const vector = (value: unknown, length: 2 | 3, path: string) => {
		if (!Array.isArray(value) || value.length !== length || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
			error(path, `must be an array of ${length} numbers`);
			return false;
		}
		return true;
	};
	const placement = (value: unknown, path: string) => {
		if (value === undefined) {
			return;
		}
		if (!isObject(value)) {
			error(path, 'must be an object with "translate" and/or "rotate"');
			return;
		}
		if (value.translate !== undefined) {
			vector(value.translate, 3, `${path}.translate`);
		}
		if (value.rotate !== undefined) {
			vector(value.rotate, 3, `${path}.rotate`);
		}
	};
	const points = (value: unknown, length: 2 | 3, minimum: number, path: string) => {
		if (!Array.isArray(value) || value.length < minimum) {
			error(path, `must be an array of at least ${minimum} points`);
			return;
		}
		value.forEach((point, index) => vector(point, length, `${path}[${index}]`));
	};

	const primitive = (shape: JsonObject, path: string) => {
		switch (shape.kind) {
			case 'box':
				if (vector(shape.size, 3, `${path}.size`)) {
					(shape.size as number[]).forEach((item, index) => positive(item, `${path}.size[${index}]`));
				}
				break;
			case 'cylinder':
				positive(shape.radius, `${path}.radius`);
				positive(shape.height, `${path}.height`);
				break;
			case 'extrudedPolygon':
				points(shape.points, 2, 3, `${path}.points`);
				positive(shape.height, `${path}.height`);
				break;
			case 'revolve':
				points(shape.profile, 2, 3, `${path}.profile`);
				if (Array.isArray(shape.profile) && shape.profile.some(point => Array.isArray(point) && typeof point[0] === 'number' && point[0] < 0)) {
					error(`${path}.profile`, 'radius values must not be negative');
				}
				if (shape.degrees !== undefined && (typeof shape.degrees !== 'number' || shape.degrees <= 0 || shape.degrees > 360)) {
					error(`${path}.degrees`, 'must be a number in (0, 360]');
				}
				break;
			case 'tube':
				points(shape.path, 3, 2, `${path}.path`);
				positive(shape.radius, `${path}.radius`);
				positive(shape.bendRadius, `${path}.bendRadius`);
				if (shape.wall !== undefined) {
					positive(shape.wall, `${path}.wall`);
					if (typeof shape.wall === 'number' && typeof shape.radius === 'number' && shape.wall >= shape.radius) {
						error(`${path}.wall`, 'must be less than the radius');
					}
				}
				break;
		}
	};

	const shapeOf = (shape: unknown, path: string, allowLibrary: boolean) => {
		if (!isObject(shape) || typeof shape.kind !== 'string') {
			error(path, 'must be an object with a "kind"');
			return;
		}
		const kind = shape.kind;
		if ((PRIMITIVE_KINDS as readonly string[]).includes(kind)) {
			primitive(shape, path);
			return;
		}
		if (!allowLibrary) {
			error(`${path}.kind`, `must be a primitive (${PRIMITIVE_KINDS.join(', ')})`);
			return;
		}
		switch (kind) {
			case 'fastener':
				positive(shape.diameter, `${path}.diameter`);
				positive(shape.length, `${path}.length`);
				if (shape.head !== undefined && shape.head !== 'hex' && shape.head !== 'round') {
					error(`${path}.head`, 'must be "hex" or "round"');
				}
				break;
			case 'spring':
				positive(shape.coilDiameter, `${path}.coilDiameter`);
				positive(shape.wireDiameter, `${path}.wireDiameter`);
				positive(shape.pitch, `${path}.pitch`);
				positive(shape.length, `${path}.length`);
				if (typeof shape.pitch === 'number' && typeof shape.wireDiameter === 'number' && shape.pitch <= shape.wireDiameter) {
					error(`${path}.pitch`, 'must be greater than the wire diameter');
				}
				break;
			case 'gear':
				if (typeof shape.teeth !== 'number' || !Number.isInteger(shape.teeth) || shape.teeth < 6 || shape.teeth > 200) {
					error(`${path}.teeth`, 'must be an integer from 6 to 200');
				}
				positive(shape.module, `${path}.module`);
				positive(shape.width, `${path}.width`);
				if (shape.bore !== undefined) {
					positive(shape.bore, `${path}.bore`);
				}
				break;
			case 'bearing':
				positive(shape.innerDiameter, `${path}.innerDiameter`);
				positive(shape.outerDiameter, `${path}.outerDiameter`);
				positive(shape.width, `${path}.width`);
				if (typeof shape.innerDiameter === 'number' && typeof shape.outerDiameter === 'number' && shape.innerDiameter >= shape.outerDiameter) {
					error(`${path}.innerDiameter`, 'must be less than the outer diameter');
				}
				break;
			case 'shaft':
				if (!Array.isArray(shape.steps) || shape.steps.length === 0) {
					error(`${path}.steps`, 'must be a non-empty array of { diameter, length }');
				} else {
					shape.steps.forEach((step, index) => {
						const stepPath = `${path}.steps[${index}]`;
						if (!isObject(step)) {
							error(stepPath, 'must be { diameter, length }');
							return;
						}
						positive(step.diameter, `${stepPath}.diameter`);
						positive(step.length, `${stepPath}.length`);
					});
				}
				break;
			case 'pipe':
				positive(shape.outerDiameter, `${path}.outerDiameter`);
				positive(shape.wall, `${path}.wall`);
				positive(shape.length, `${path}.length`);
				if (typeof shape.wall === 'number' && typeof shape.outerDiameter === 'number' && 2 * shape.wall >= shape.outerDiameter) {
					error(`${path}.wall`, 'must be less than half the outer diameter');
				}
				break;
			case 'motor':
				positive(shape.diameter, `${path}.diameter`);
				positive(shape.length, `${path}.length`);
				positive(shape.shaftDiameter, `${path}.shaftDiameter`);
				positive(shape.shaftLength, `${path}.shaftLength`);
				break;
			case 'code':
				if (typeof shape.code !== 'string' || shape.code.trim() === '') {
					error(`${path}.code`, 'must be a non-empty string of replicad code');
				}
				if (!options.allowCode) {
					error(`${path}.kind`, 'the code escape hatch is opt-in and this caller did not allow it', 'code-not-allowed', 'ADR 0014 decision 1 (per-part code escape hatch, opt-in)');
				}
				break;
			default:
				error(`${path}.kind`, `unknown kind "${kind}" (primitives: ${PRIMITIVE_KINDS.join(', ')}; library: ${LIBRARY_KINDS.join(', ')}; code)`);
		}
	};

	if (!isObject(input)) {
		error('scene', 'must be a JSON object');
		return { findings };
	}
	if (typeof input.figure !== 'string' || !/^FIG-\d+[A-Z]?$/.test(input.figure)) {
		error('figure', 'must be "FIG-N", e.g. "FIG-1"');
	}
	if (typeof input.camera !== 'string' || !(CAMERA_PRESETS as readonly string[]).includes(input.camera)) {
		error('camera', `must be one of ${CAMERA_PRESETS.join(', ')}`);
	}
	if (input.hiddenEdges !== undefined && input.hiddenEdges !== 'omit' && input.hiddenEdges !== 'dashed') {
		error('hiddenEdges', 'must be "omit" or "dashed"');
	}
	if (input.scale !== undefined) {
		positive(input.scale, 'scale');
	}
	if (input.section !== undefined) {
		const section = input.section;
		if (!isObject(section)) {
			error('section', 'must be { origin, normal, keep? }');
		} else {
			vector(section.origin, 3, 'section.origin');
			if (!(section.normal === 'x' || section.normal === 'y' || section.normal === 'z') && vector(section.normal, 3, 'section.normal') && (section.normal as number[]).every(item => item === 0)) {
				error('section.normal', 'must not be the zero vector');
			}
			if (section.keep !== undefined && section.keep !== 'positive' && section.keep !== 'negative') {
				error('section.keep', 'must be "positive" or "negative"');
			}
		}
	}
	const ids = new Set<string>();
	if (!Array.isArray(input.parts) || input.parts.length === 0) {
		error('parts', 'must be a non-empty array');
	} else {
		input.parts.forEach((part, index) => {
			const path = `parts[${index}]`;
			if (!isObject(part)) {
				error(path, 'must be an object');
				return;
			}
			if (typeof part.id !== 'string' || !/^[A-Za-z][\w-]*$/.test(part.id)) {
				error(`${path}.id`, 'must be an identifier such as "housing"');
			} else if (ids.has(part.id)) {
				error(`${path}.id`, `duplicate part id "${part.id}"`);
			} else {
				ids.add(part.id);
			}
			if (part.name !== undefined && typeof part.name !== 'string') {
				error(`${path}.name`, 'must be a string');
			}
			shapeOf(part.shape, `${path}.shape`, true);
			placement(part.placement, `${path}.placement`);
			if (part.subtract !== undefined) {
				if (!Array.isArray(part.subtract)) {
					error(`${path}.subtract`, 'must be an array of { shape, placement? }');
				} else {
					part.subtract.forEach((cut, cutIndex) => {
						const cutPath = `${path}.subtract[${cutIndex}]`;
						if (!isObject(cut)) {
							error(cutPath, 'must be { shape, placement? }');
							return;
						}
						shapeOf(cut.shape, `${cutPath}.shape`, false);
						placement(cut.placement, `${cutPath}.placement`);
					});
				}
			}
		});
	}
	if (!Array.isArray(input.numerals)) {
		error('numerals', 'must be an array');
	} else {
		input.numerals.forEach((port, index) => {
			const path = `numerals[${index}]`;
			if (!isObject(port)) {
				error(path, 'must be { numeral, part, face, point?, surface? }');
				return;
			}
			if (typeof port.numeral !== 'string' || !NUMERAL_PATTERN.test(port.numeral)) {
				error(`${path}.numeral`, 'must be a reference numeral such as "10" or "12a"');
			}
			if (typeof port.part !== 'string') {
				error(`${path}.part`, 'must be a part id');
			}
			if (typeof port.face !== 'string') {
				error(`${path}.face`, 'must be a face or port name of the part');
			}
			if (port.point !== undefined) {
				vector(port.point, 3, `${path}.point`);
			}
			if (port.surface !== undefined && typeof port.surface !== 'boolean') {
				error(`${path}.surface`, 'must be true or false');
			}
		});
	}
	return findings.length === 0 ? { scene: input as unknown as DrawingScene, findings } : { findings };
}
