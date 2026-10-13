/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CameraPreset, NumeralPort, PartShape, Placement, ScenePart, Vec2, Vec3 } from './drawingScene';

/**
 * An orthographic camera. `direction` points from the object to the viewer; `xAxis` is screen
 * right and `yAxis` (= direction x xAxis) is screen up. The node layer gives the same basis to
 * the kernel, so a port point projects exactly where the kernel draws its face.
 */
export interface CameraBasis {
	readonly direction: Vec3;
	readonly xAxis: Vec3;
	readonly yAxis: Vec3;
}

const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);

const CAMERAS: Readonly<Record<CameraPreset, CameraBasis>> = {
	isometric: { direction: [1 / SQRT3, -1 / SQRT3, 1 / SQRT3], xAxis: [1 / SQRT2, 1 / SQRT2, 0], yAxis: [-1 / SQRT6, 1 / SQRT6, 2 / SQRT6] },
	front: { direction: [0, -1, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] },
	top: { direction: [0, 0, 1], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
	side: { direction: [1, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1] },
};

/** The basis of a camera preset. */
export function cameraBasis(preset: CameraPreset): CameraBasis {
	return CAMERAS[preset];
}

/** Projects a model point to drawing coordinates: x to the right, y down (SVG orientation). */
export function projectPoint(camera: CameraBasis, point: Vec3): Vec2 {
	return [dot(point, camera.xAxis), -dot(point, camera.yAxis)];
}

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function add(a: Vec3, b: Vec3): Vec3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, factor: number): Vec3 {
	return [a[0] * factor, a[1] * factor, a[2] * factor];
}

export function normalize(a: Vec3): Vec3 | undefined {
	const length = Math.hypot(a[0], a[1], a[2]);
	return length < 1e-12 ? undefined : scale(a, 1 / length);
}

function rotateAbout(point: Vec3, axis: 0 | 1 | 2, degrees: number): Vec3 {
	if (!degrees) {
		return point;
	}
	const radians = degrees * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const [x, y, z] = point;
	switch (axis) {
		case 0: return [x, y * cos - z * sin, y * sin + z * cos];
		case 1: return [x * cos + z * sin, y, -x * sin + z * cos];
		default: return [x * cos - y * sin, x * sin + y * cos, z];
	}
}

/** Applies a placement to a part-local point: rotate about X, then Y, then Z, then translate. */
export function applyPlacement(placement: Placement | undefined, point: Vec3): Vec3 {
	const rotation = placement?.rotate ?? [0, 0, 0];
	let result = rotateAbout(point, 0, rotation[0]);
	result = rotateAbout(result, 1, rotation[1]);
	result = rotateAbout(result, 2, rotation[2]);
	return placement?.translate ? add(result, placement.translate) : result;
}

/** Applies the inverse rotation of a placement to a direction (world to part-local). */
function toLocalDirection(placement: Placement | undefined, direction: Vec3): Vec3 {
	const rotation = placement?.rotate ?? [0, 0, 0];
	let result = rotateAbout(direction, 2, -rotation[2]);
	result = rotateAbout(result, 1, -rotation[1]);
	return rotateAbout(result, 0, -rotation[0]);
}

/** The face and port names of a shape; `undefined` for a code part, which takes any name with a point. */
export function faceNames(shape: PartShape): readonly string[] | undefined {
	switch (shape.kind) {
		case 'box': return ['top', 'bottom', 'front', 'back', 'left', 'right'];
		case 'cylinder': return ['top', 'bottom', 'side'];
		case 'extrudedPolygon': return ['top', 'bottom', ...numbered('side', shape.points.length)];
		case 'revolve': return numbered('profile', shape.profile.length);
		case 'tube': return numbered('segment', Math.max(0, shape.path.length - 1));
		case 'fastener': return ['head', 'shank', 'tip'];
		case 'spring': return ['top', 'bottom', 'coil'];
		case 'gear': return ['teeth', 'face', 'bore'];
		case 'bearing': return ['outer-race', 'inner-race', 'face'];
		case 'shaft': return ['end-1', 'end-2', ...numbered('step', shape.steps.length)];
		case 'pipe': return ['outer', 'bore', 'end-1', 'end-2'];
		case 'motor': return ['body', 'face', 'shaft'];
		case 'code': return undefined;
	}
}

function numbered(prefix: string, count: number): string[] {
	return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
}

/** Fastener head height and hex circumradius as fractions of the shank diameter. */
export const FASTENER_HEAD_HEIGHT = 0.7;
export const FASTENER_HEAD_RADIUS = 0.9;
/** Bearing ring thickness and ball diameter as fractions of the radial section. */
export const BEARING_RING = 0.3;
export const BEARING_BALL = 0.38;
/** Motor boss radius and height as fractions of the can diameter and length. */
export const MOTOR_BOSS_RADIUS = 0.25;
export const MOTOR_BOSS_HEIGHT = 0.05;

/**
 * The anchor point of a named face of a shape, in the part-local frame. `toViewer` is the camera
 * direction in the same frame: a curved face takes the point that faces the viewer.
 */
function faceAnchor(shape: PartShape, face: string, toViewer: Vec3): Vec3 | undefined {
	const radial = (radius: number, z: number): Vec3 => {
		const planar = Math.hypot(toViewer[0], toViewer[1]);
		return planar < 1e-9 ? [radius, 0, z] : [radius * toViewer[0] / planar, radius * toViewer[1] / planar, z];
	};
	const index = (prefix: string) => face.startsWith(`${prefix}-`) ? Number(face.slice(prefix.length + 1)) - 1 : -1;
	switch (shape.kind) {
		case 'box': {
			const [a, b, c] = shape.size;
			const table: Record<string, Vec3> = { top: [a / 2, b / 2, c], bottom: [a / 2, b / 2, 0], front: [a / 2, 0, c / 2], back: [a / 2, b, c / 2], left: [0, b / 2, c / 2], right: [a, b / 2, c / 2] };
			return table[face];
		}
		case 'cylinder':
			return face === 'top' ? [0, 0, shape.height] : face === 'bottom' ? [0, 0, 0] : face === 'side' ? radial(shape.radius, shape.height / 2) : undefined;
		case 'extrudedPolygon': {
			const points = shape.points;
			if (face === 'top' || face === 'bottom') {
				const cx = points.reduce((sum, point) => sum + point[0], 0) / points.length;
				const cy = points.reduce((sum, point) => sum + point[1], 0) / points.length;
				return [cx, cy, face === 'top' ? shape.height : 0];
			}
			const i = index('side');
			if (i < 0 || i >= points.length) {
				return undefined;
			}
			const from = points[i];
			const to = points[(i + 1) % points.length];
			return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, shape.height / 2];
		}
		case 'revolve': {
			const i = index('profile');
			const profile = shape.profile;
			if (i < 0 || i >= profile.length) {
				return undefined;
			}
			const from = profile[i];
			const to = profile[(i + 1) % profile.length];
			return radial((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
		}
		case 'tube': {
			const i = index('segment');
			if (i < 0 || i >= shape.path.length - 1) {
				return undefined;
			}
			const from = shape.path[i];
			const to = shape.path[i + 1];
			const middle = scale(add(from, to), 0.5);
			const along = normalize(add(to, scale(from, -1)));
			const across = along ? normalize(add(toViewer, scale(along, -dot(toViewer, along)))) : undefined;
			return across ? add(middle, scale(across, shape.radius)) : middle;
		}
		case 'fastener': {
			const head = FASTENER_HEAD_HEIGHT * shape.diameter;
			return face === 'head' ? radial(FASTENER_HEAD_RADIUS * shape.diameter * 0.85, head / 2) : face === 'shank' ? radial(shape.diameter / 2, -shape.length / 2) : face === 'tip' ? [0, 0, -shape.length] : undefined;
		}
		case 'spring': {
			const outer = (shape.coilDiameter + shape.wireDiameter) / 2;
			return face === 'top' ? radial(outer, shape.length - shape.wireDiameter / 2) : face === 'bottom' ? radial(outer, shape.wireDiameter / 2) : face === 'coil' ? radial(outer, shape.length / 2) : undefined;
		}
		case 'gear': {
			const pitch = shape.module * shape.teeth / 2;
			const root = pitch - 1.25 * shape.module;
			const bore = shape.bore ?? 0;
			if (face === 'teeth') {
				const step = 2 * Math.PI / shape.teeth;
				const angle = Math.round(Math.atan2(toViewer[1], toViewer[0]) / step) * step;
				return [pitch * Math.cos(angle), pitch * Math.sin(angle), shape.width / 2];
			}
			return face === 'face' ? radial((bore / 2 + root) / 2, shape.width) : face === 'bore' && bore > 0 ? radial(-bore / 2, shape.width / 2) : undefined;
		}
		case 'bearing': {
			const section = (shape.outerDiameter - shape.innerDiameter) / 2;
			const ring = BEARING_RING * section;
			return face === 'outer-race' ? radial(shape.outerDiameter / 2, shape.width / 2) : face === 'inner-race' ? radial(shape.innerDiameter / 2 + ring / 2, shape.width) : face === 'face' ? radial(shape.outerDiameter / 2 - ring / 2, shape.width) : undefined;
		}
		case 'shaft': {
			const total = shape.steps.reduce((sum, step) => sum + step.length, 0);
			if (face === 'end-1' || face === 'end-2') {
				return [0, 0, face === 'end-1' ? 0 : total];
			}
			const i = index('step');
			if (i < 0 || i >= shape.steps.length) {
				return undefined;
			}
			const start = shape.steps.slice(0, i).reduce((sum, step) => sum + step.length, 0);
			return radial(shape.steps[i].diameter / 2, start + shape.steps[i].length / 2);
		}
		case 'pipe': {
			const outer = shape.outerDiameter / 2;
			const inner = outer - shape.wall;
			return face === 'outer' ? radial(outer, shape.length / 2) : face === 'bore' ? radial(-inner, shape.length) : face === 'end-1' ? radial((outer + inner) / 2, 0) : face === 'end-2' ? radial((outer + inner) / 2, shape.length) : undefined;
		}
		case 'motor': {
			const radius = shape.diameter / 2;
			const boss = MOTOR_BOSS_RADIUS * shape.diameter;
			return face === 'body' ? radial(radius, shape.length / 2) : face === 'face' ? radial((radius + boss) / 2, shape.length) : face === 'shaft' ? radial(shape.shaftDiameter / 2, shape.length + MOTOR_BOSS_HEIGHT * shape.length + shape.shaftLength / 2) : undefined;
		}
		case 'code':
			return undefined;
	}
}

/**
 * The model point a numeral port points at: the port's own point, or the face anchor, moved by
 * the part placement. `undefined` when the part or face does not resolve.
 */
export function resolvePort(port: NumeralPort, part: ScenePart | undefined, camera: CameraBasis): Vec3 | undefined {
	if (!part) {
		return undefined;
	}
	if (port.point) {
		return applyPlacement(part.placement, port.point);
	}
	const local = faceAnchor(part.shape, port.face, toLocalDirection(part.placement, camera.direction));
	return local && applyPlacement(part.placement, local);
}
