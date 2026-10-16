/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vm from 'node:vm';
import type { CodeShape, LibraryShape, PartShape, Placement, PrimitiveShape, ProfileItem, ScenePart, Vec2, Vec3 } from '../../common/scene/drawingScene';
import { camProfile, hasCurves, profileSegments, sampleSpline } from '../../common/scene/profile';
import { add, BEARING_BALL, BEARING_RING, FASTENER_HEAD_HEIGHT, FASTENER_HEAD_RADIUS, MOTOR_BOSS_HEIGHT, MOTOR_BOSS_RADIUS, normalize, scale } from '../../common/scene/sceneGeometry';
import { KernelCurve, KernelShape, KernelSketch, point3, ReplicadApi } from './drawingKernel';

/** Time limit for one code escape hatch part, in milliseconds. */
const CODE_TIMEOUT = 5000;

/** Points per Catmull-Rom piece that the B-spline edge of a spline segment is fitted through. */
const SPLINE_SAMPLES = 8;
/** Largest distance of the fitted B-spline from the sampled spline points, in model millimetres. */
const SPLINE_TOLERANCE = 1e-3;

/**
 * The closed sketch of a profile with arcs or splines, from kernel edges. `lift` maps a profile
 * point to model space. Each spline segment becomes ONE B-spline edge: the side it extrudes or
 * revolves into is one smooth face, so the hidden-line removal draws no seam lines inside it.
 */
function curvedSketch(r: ReplicadApi, items: readonly ProfileItem[], lift: (point: Vec2) => [number, number, number]): KernelSketch {
	const edges: KernelCurve[] = profileSegments(items).map(segment => {
		switch (segment.kind) {
			case 'line':
				return r.makeLine(lift(segment.from), lift(segment.to));
			case 'arc':
				return r.makeThreePointArc(lift(segment.from), lift(segment.through), lift(segment.to));
			case 'spline':
				return r.makeBSplineApproximation(sampleSpline(segment, SPLINE_SAMPLES).map(lift), { tolerance: SPLINE_TOLERANCE, degMin: 3, degMax: 8 });
		}
	});
	return new r.Sketch(r.assembleWire(edges));
}

function extrudePolygon(r: ReplicadApi, points: readonly ProfileItem[], height: number): KernelShape {
	if (hasCurves(points)) {
		return curvedSketch(r, points, ([x, y]) => [x, y, 0]).extrude(height);
	}
	const corners = points as readonly Vec2[];
	let pen = r.draw([corners[0][0], corners[0][1]]);
	for (const point of corners.slice(1)) {
		pen = pen.lineTo([point[0], point[1]]);
	}
	return pen.close().sketchOnPlane('XY').extrude(height);
}

/** Revolves a closed (radius, z) profile about the Z axis. The XZ plane maps (u, v) to (u, 0, v). */
function revolveProfile(r: ReplicadApi, profile: readonly ProfileItem[], degrees = 360): KernelShape {
	const options = { origin: [0, 0, 0] as [number, number, number], angle: degrees };
	if (hasCurves(profile)) {
		return curvedSketch(r, profile, ([u, v]) => [u, 0, v]).revolve([0, 0, 1], options);
	}
	const corners = profile as readonly Vec2[];
	let pen = r.draw([corners[0][0], corners[0][1]]);
	for (const point of corners.slice(1)) {
		pen = pen.lineTo([point[0], point[1]]);
	}
	return pen.close().sketchOnPlane('XZ').revolve([0, 0, 1], options);
}

/** A round sweep along a polyline whose inner corners are rounded with `bendRadius`. */
function sweepTube(r: ReplicadApi, path: readonly Vec3[], radius: number, bendRadius: number): KernelShape {
	const edges: KernelCurve[] = [];
	let cursor: Vec3 = path[0];
	for (let i = 1; i < path.length; i++) {
		const corner = path[i];
		const isLast = i === path.length - 1;
		if (isLast) {
			edges.push(r.makeLine(point3(cursor), point3(corner)));
			break;
		}
		const inDirection = normalize(add(corner, scale(path[i - 1], -1)));
		const outDirection = normalize(add(path[i + 1], scale(corner, -1)));
		if (!inDirection || !outDirection) {
			continue;
		}
		const cos = Math.max(-1, Math.min(1, inDirection[0] * outDirection[0] + inDirection[1] * outDirection[1] + inDirection[2] * outDirection[2]));
		const turn = Math.acos(cos);
		if (turn < 1e-6) {
			continue;
		}
		const setback = bendRadius * Math.tan(turn / 2);
		const arcStart = add(corner, scale(inDirection, -setback));
		const arcEnd = add(corner, scale(outDirection, setback));
		const bisector = normalize(add(scale(inDirection, -1), outDirection))!;
		const toCentre = bendRadius / Math.cos(turn / 2);
		const centre = add(corner, scale(bisector, toCentre));
		const middle = add(centre, scale(normalize(add(corner, scale(centre, -1)))!, bendRadius));
		edges.push(r.makeLine(point3(cursor), point3(arcStart)));
		edges.push(r.makeThreePointArc(point3(arcStart), point3(middle), point3(arcEnd)));
		cursor = arcEnd;
	}
	const spine = r.assembleWire(edges);
	const start = normalize(add(path[1], scale(path[0], -1)))!;
	const profile = r.assembleWire([r.makeCircle(radius, point3(path[0]), point3(start))]);
	return r.genericSweep(profile, spine, { frenet: false, transitionMode: 'round' });
}

function primitive(r: ReplicadApi, shape: PrimitiveShape): KernelShape {
	switch (shape.kind) {
		case 'box':
			return r.makeBox([0, 0, 0], point3(shape.size));
		case 'cylinder':
			return r.makeCylinder(shape.radius, shape.height, [0, 0, 0], [0, 0, 1]);
		case 'extrudedPolygon':
			return extrudePolygon(r, shape.points, shape.height);
		case 'revolve':
			return revolveProfile(r, shape.profile, shape.degrees);
		case 'tube': {
			const outer = sweepTube(r, shape.path, shape.radius, shape.bendRadius);
			if (shape.wall === undefined) {
				return outer;
			}
			// The bore runs a little past both ends so the cut leaves clean open ends.
			const path = [...shape.path];
			const first = normalize(add(path[0], scale(path[1], -1)))!;
			const last = normalize(add(path[path.length - 1], scale(path[path.length - 2], -1)))!;
			path[0] = add(path[0], scale(first, shape.wall));
			path[path.length - 1] = add(path[path.length - 1], scale(last, shape.wall));
			return outer.cut(sweepTube(r, path, shape.radius - shape.wall, shape.bendRadius));
		}
	}
}

function gearOutline(teeth: number, module: number): Vec2[] {
	const pitch = module * teeth / 2;
	const tip = pitch + module;
	const root = pitch - 1.25 * module;
	const step = 2 * Math.PI / teeth;
	const points: Vec2[] = [];
	for (let k = 0; k < teeth; k++) {
		const centre = k * step;
		for (const [radius, offset] of [[root, -0.3], [tip, -0.14], [tip, 0.14], [root, 0.3]] as const) {
			const angle = centre + offset * step;
			points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
		}
	}
	return points;
}

function library(r: ReplicadApi, shape: LibraryShape): KernelShape {
	switch (shape.kind) {
		case 'fastener': {
			const headHeight = FASTENER_HEAD_HEIGHT * shape.diameter;
			const headRadius = FASTENER_HEAD_RADIUS * shape.diameter;
			const head = shape.head === 'round'
				? r.makeCylinder(headRadius, headHeight, [0, 0, 0], [0, 0, 1])
				: r.drawPolysides(headRadius, 6).sketchOnPlane('XY').extrude(headHeight);
			return head.fuse(r.makeCylinder(shape.diameter / 2, shape.length, [0, 0, -shape.length], [0, 0, 1]));
		}
		case 'spring': {
			const radius = shape.coilDiameter / 2;
			const height = shape.length - shape.wireDiameter;
			const helix = r.makeHelix(shape.pitch, height, radius, [0, 0, shape.wireDiameter / 2], [0, 0, 1]);
			const tangent = helix.tangentAt(0);
			const profile = r.assembleWire([r.makeCircle(shape.wireDiameter / 2, helix.startPoint, tangent)]);
			return r.genericSweep(profile, helix, { frenet: true });
		}
		case 'gear': {
			const gear = extrudePolygon(r, gearOutline(shape.teeth, shape.module), shape.width);
			return shape.bore ? gear.cut(r.makeCylinder(shape.bore / 2, shape.width + 2, [0, 0, -1], [0, 0, 1])) : gear;
		}
		case 'bearing': {
			const outer = shape.outerDiameter / 2;
			const inner = shape.innerDiameter / 2;
			const section = outer - inner;
			const ring = BEARING_RING * section;
			const ball = BEARING_BALL * section;
			const middle = (outer + inner) / 2;
			const rings = revolveProfile(r, [[outer - ring, 0], [outer, 0], [outer, shape.width], [outer - ring, shape.width]])
				.fuse(revolveProfile(r, [[inner, 0], [inner + ring, 0], [inner + ring, shape.width], [inner, shape.width]]));
			const count = Math.max(3, Math.floor(2 * Math.PI * middle / (1.5 * ball)));
			const balls: KernelShape[] = [];
			for (let k = 0; k < count; k++) {
				const angle = 2 * Math.PI * k / count;
				balls.push(r.makeSphere(ball / 2).translate([middle * Math.cos(angle), middle * Math.sin(angle), shape.width / 2]));
			}
			return r.makeCompound([rings, ...balls]);
		}
		case 'shaft': {
			const profile: Vec2[] = [[0, 0]];
			let z = 0;
			for (const step of shape.steps) {
				profile.push([step.diameter / 2, z], [step.diameter / 2, z + step.length]);
				z += step.length;
			}
			profile.push([0, z]);
			return revolveProfile(r, profile);
		}
		case 'pipe': {
			const outer = shape.outerDiameter / 2;
			const inner = outer - shape.wall;
			return revolveProfile(r, [[inner, 0], [outer, 0], [outer, shape.length], [inner, shape.length]]);
		}
		case 'motor': {
			const boss = MOTOR_BOSS_RADIUS * shape.diameter;
			const bossHeight = MOTOR_BOSS_HEIGHT * shape.length;
			return r.makeCylinder(shape.diameter / 2, shape.length, [0, 0, 0], [0, 0, 1])
				.fuse(r.makeCylinder(boss, bossHeight, [0, 0, shape.length], [0, 0, 1]))
				.fuse(r.makeCylinder(shape.shaftDiameter / 2, shape.shaftLength, [0, 0, shape.length + bossHeight], [0, 0, 1]));
		}
		case 'cam':
			return extrudePolygon(r, camProfile(shape), shape.height);
	}
}

/**
 * Runs a code escape hatch part. The code is a function body that gets only `replicad` and returns
 * one solid. It runs in a separate VM context (no `require`, `process` or file system in scope)
 * with a time limit. A VM context limits scope; it is not a security boundary, which is why the
 * escape hatch is opt-in for the caller.
 */
function codePart(r: ReplicadApi, shape: CodeShape): KernelShape {
	const context = vm.createContext({ replicad: r });
	const result: unknown = vm.runInContext(`(function (replicad) {\n${shape.code}\n})(replicad)`, context, { timeout: CODE_TIMEOUT });
	if (result instanceof r.Solid || result instanceof r.Compound || result instanceof r.CompSolid || result instanceof r.Shell) {
		return result as KernelShape;
	}
	throw new Error('the code must return one replicad solid');
}

function place(shape: KernelShape, placement: Placement | undefined): KernelShape {
	const [rx, ry, rz] = placement?.rotate ?? [0, 0, 0];
	let result = shape;
	if (rx) {
		result = result.rotate(rx, [0, 0, 0], [1, 0, 0]);
	}
	if (ry) {
		result = result.rotate(ry, [0, 0, 0], [0, 1, 0]);
	}
	if (rz) {
		result = result.rotate(rz, [0, 0, 0], [0, 0, 1]);
	}
	return placement?.translate ? result.translate(point3(placement.translate)) : result;
}

function partShape(r: ReplicadApi, shape: PartShape): KernelShape {
	switch (shape.kind) {
		case 'code':
			return codePart(r, shape);
		case 'box':
		case 'cylinder':
		case 'extrudedPolygon':
		case 'revolve':
		case 'tube':
			return primitive(r, shape);
		default:
			return library(r, shape);
	}
}

/** Builds one part as a solid in model coordinates: shape, subtractions, then placement. */
export function buildPart(r: ReplicadApi, part: ScenePart): KernelShape {
	let solid = partShape(r, part.shape);
	for (const cut of part.subtract ?? []) {
		solid = solid.cut(place(primitive(r, cut.shape), cut.placement));
	}
	return place(solid, part.placement);
}
