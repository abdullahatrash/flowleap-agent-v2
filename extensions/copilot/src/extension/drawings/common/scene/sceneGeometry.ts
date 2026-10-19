/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CameraPreset, NumeralPort, PartShape, Placement, ScenePart, SectionPlane, UNSECTIONED_KINDS, Vec2, Vec3 } from './drawingScene';
import { camPoint, camPortAngles, profileSegments, profileVertices, segmentMidpoint } from './profile';

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
function applyPlacement(placement: Placement | undefined, point: Vec3): Vec3 {
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

/**
 * The port of a part's Z axis (`shaft`, `cylinder`, `revolve`, `extrudedPolygon`, `cam`). A numeral on it
 * gets a centre mark: an axis has no edge for the lead line to end on.
 */
export const AXIS_PORT = 'axis';

/** The shape kinds that have a Z axis, and so an `axis` port and a chain centre line. */
export const AXIS_KINDS: readonly PartShape['kind'][] = ['cylinder', 'extrudedPolygon', 'revolve', 'shaft', 'cam'];

/** The face and port names of a shape; `undefined` for a code part, which takes any name with a point. */
export function faceNames(shape: PartShape): readonly string[] | undefined {
	switch (shape.kind) {
		case 'box': return ['top', 'bottom', 'front', 'back', 'left', 'right'];
		case 'cylinder': return ['top', 'bottom', 'side', AXIS_PORT];
		case 'extrudedPolygon': return ['top', 'bottom', ...numbered('side', profileSegments(shape.points).length), AXIS_PORT];
		case 'revolve': return [...numbered('profile', profileSegments(shape.profile).length), AXIS_PORT];
		case 'tube': return numbered('segment', Math.max(0, shape.path.length - 1));
		case 'fastener': return ['head', 'shank', 'tip'];
		case 'spring': return ['top', 'bottom', 'coil'];
		case 'gear': return ['teeth', 'face', 'bore'];
		case 'bearing': return ['outer-race', 'inner-race', 'face'];
		case 'shaft': return ['end-1', 'end-2', ...numbered('step', shape.steps.length), AXIS_PORT];
		case 'pipe': return ['outer', 'bore', 'end-1', 'end-2'];
		case 'motor': return ['body', 'face', 'shaft'];
		case 'cam': return ['top', 'bottom', AXIS_PORT, ...numbered('lobe', shape.lobes.length), ...numbered('land', shape.lobes.length)];
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

/** The lowest and highest z of the part-local Z axis of a shape that has an `axis` port. */
function axisExtent(shape: PartShape): Vec2 | undefined {
	switch (shape.kind) {
		case 'cylinder':
		case 'extrudedPolygon':
		case 'cam':
			return [0, shape.height];
		case 'revolve': {
			const zs = profileVertices(shape.profile).map(point => point[1]);
			return [Math.min(...zs), Math.max(...zs)];
		}
		case 'shaft':
			return [0, shape.steps.reduce((sum, step) => sum + step.length, 0)];
		default:
			return undefined;
	}
}

/** The part-local normal of a named plane face, or `undefined` for a curved face or a port. */
function planeNormal(shape: PartShape, face: string): Vec3 | undefined {
	const zFaces: Partial<Record<PartShape['kind'], readonly string[]>> = {
		cylinder: ['top', 'bottom'],
		extrudedPolygon: ['top', 'bottom'],
		shaft: ['end-1', 'end-2'],
		pipe: ['end-1', 'end-2'],
		motor: ['face'],
		gear: ['face'],
		bearing: ['face'],
	};
	if (zFaces[shape.kind]?.includes(face)) {
		return [0, 0, 1];
	}
	if (shape.kind === 'box') {
		const table: Record<string, Vec3> = { top: [0, 0, 1], bottom: [0, 0, -1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
		return table[face];
	}
	const side = /^(?<prefix>side|profile)-(?<number>\d+)$/.exec(face);
	if (!side) {
		return undefined;
	}
	const i = Number(side.groups!.number) - 1;
	// Only a straight segment gives a plane side; an arc or a spline side is curved.
	if (shape.kind === 'extrudedPolygon' && side.groups!.prefix === 'side') {
		const segment = profileSegments(shape.points)[i];
		return segment?.kind === 'line' ? normalize([segment.to[1] - segment.from[1], segment.from[0] - segment.to[0], 0]) : undefined;
	}
	if (shape.kind === 'revolve' && side.groups!.prefix === 'profile') {
		// A straight profile segment at one z is a flat ring; every other segment is a cone, a cylinder or curved.
		const segment = profileSegments(shape.profile)[i];
		return segment?.kind === 'line' && Math.abs(segment.to[1] - segment.from[1]) < 1e-9 ? [0, 0, 1] : undefined;
	}
	return undefined;
}

/**
 * True when the face of the port is a plane seen edge-on by the camera: it projects to a line, so
 * the lead line must meet that line at an angle and never run along it.
 */
export function isPortEdgeOn(port: NumeralPort, part: ScenePart | undefined, camera: CameraBasis): boolean {
	const normal = part && planeNormal(part.shape, port.face);
	return normal !== undefined && Math.abs(dot(normal, toLocalDirection(part!.placement, camera.direction))) < 1e-6;
}

/** True when the port gets a centre mark: `mark: "centre"`, or the `axis` port. */
export function hasCentreMark(port: NumeralPort): boolean {
	return port.mark === 'centre' || port.face === AXIS_PORT;
}

/**
 * The direction of a part's Z axis on the drawing plane: the projection of one unit of the placed
 * axis, in model millimetres. Near zero length when the camera looks along the axis. `undefined`
 * for a shape without an axis.
 */
export function projectedAxis(part: ScenePart, camera: CameraBasis): Vec2 | undefined {
	if (!AXIS_KINDS.includes(part.shape.kind)) {
		return undefined;
	}
	const origin = projectPoint(camera, applyPlacement(part.placement, [0, 0, 0]));
	const tip = projectPoint(camera, applyPlacement(part.placement, [0, 0, 1]));
	return [tip[0] - origin[0], tip[1] - origin[1]];
}

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
	if (face === AXIS_PORT) {
		const extent = axisExtent(shape);
		if (!extent) {
			return undefined;
		}
		// Seen along the axis, the axis is the centre of the top face; else take its midpoint.
		const alongAxis = Math.abs(toViewer[2]) > 1 - 1e-6;
		return [0, 0, alongAxis ? extent[1] : (extent[0] + extent[1]) / 2];
	}
	switch (shape.kind) {
		case 'box': {
			const [a, b, c] = shape.size;
			const table: Record<string, Vec3> = { top: [a / 2, b / 2, c], bottom: [a / 2, b / 2, 0], front: [a / 2, 0, c / 2], back: [a / 2, b, c / 2], left: [0, b / 2, c / 2], right: [a, b / 2, c / 2] };
			return table[face];
		}
		case 'cylinder':
			return face === 'top' ? [0, 0, shape.height] : face === 'bottom' ? [0, 0, 0] : face === 'side' ? radial(shape.radius, shape.height / 2) : undefined;
		case 'extrudedPolygon': {
			if (face === 'top' || face === 'bottom') {
				const points = profileVertices(shape.points);
				const cx = points.reduce((sum, point) => sum + point[0], 0) / points.length;
				const cy = points.reduce((sum, point) => sum + point[1], 0) / points.length;
				return [cx, cy, face === 'top' ? shape.height : 0];
			}
			const segment = profileSegments(shape.points)[index('side')];
			if (!segment) {
				return undefined;
			}
			const [x, y] = segmentMidpoint(segment);
			return [x, y, shape.height / 2];
		}
		case 'revolve': {
			const segment = profileSegments(shape.profile)[index('profile')];
			if (!segment) {
				return undefined;
			}
			const [radius, z] = segmentMidpoint(segment);
			return radial(radius, z);
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
		case 'cam': {
			if (face === 'top') {
				return [0, 0, shape.height];
			}
			if (face === 'bottom') {
				return [0, 0, 0];
			}
			const angles = camPortAngles(shape);
			const angle = face.startsWith('lobe-') ? angles.lobes[index('lobe')] : face.startsWith('land-') ? angles.lands[index('land')] : undefined;
			if (angle === undefined) {
				return undefined;
			}
			const [x, y] = camPoint(shape, angle);
			return [x, y, shape.height / 2];
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

/** The unit normal of a section plane. */
export function sectionNormal(section: SectionPlane): Vec3 {
	const named: Record<string, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
	const raw = typeof section.normal === 'string' ? named[section.normal] : section.normal;
	return normalize(raw) ?? [0, 0, 1];
}

/** The outer radius of a part that stays unsectioned along its axis; 0 for other kinds. */
function axialRadius(shape: PartShape): number {
	switch (shape.kind) {
		case 'shaft': return Math.max(...shape.steps.map(step => step.diameter)) / 2;
		case 'fastener': return Math.max(shape.diameter / 2, FASTENER_HEAD_RADIUS * shape.diameter);
		case 'spring': return (shape.coilDiameter + shape.wireDiameter) / 2;
		default: return 0;
	}
}

/**
 * True when the section cuts the part and hatches its cut face. The part's `sectioned` field wins.
 * Without it, a `shaft`, `fastener` or `spring` stays unsectioned when the plane runs along its
 * axis: the plane is parallel to the axis and passes through the part. A plane across the axis
 * sections it as usual. Every other part is sectioned.
 */
export function isSectioned(part: ScenePart, section: SectionPlane): boolean {
	if (part.sectioned !== undefined) {
		return part.sectioned;
	}
	if (!(UNSECTIONED_KINDS as readonly string[]).includes(part.shape.kind)) {
		return true;
	}
	const normal = sectionNormal(section);
	const origin = applyPlacement(part.placement, [0, 0, 0]);
	const axis = add(applyPlacement(part.placement, [0, 0, 1]), scale(origin, -1));
	const along = Math.abs(dot(axis, normal)) < 1e-6;
	const distance = Math.abs(dot(add(origin, scale(section.origin, -1)), normal));
	return !(along && distance < axialRadius(part.shape));
}
