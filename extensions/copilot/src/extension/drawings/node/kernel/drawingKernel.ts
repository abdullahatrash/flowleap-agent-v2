/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * The replicad surface the drawings engine calls, typed here on purpose. replicad's own typings
 * import `@types/opentype.js`, which pulls the DOM library into the whole extension program and
 * breaks unrelated code. Keeping the calls to this small, documented surface is also what the
 * engine research advises for a one-maintainer wrapper (04-geometry-engines.md section 9).
 * replicad 1.1.0 is pinned in package.json.
 */

export type Point3 = [number, number, number];

/** A mutable copy of a readonly scene vector, as the kernel functions take it. */
export function point3(vector: readonly [number, number, number]): Point3 {
	return [vector[0], vector[1], vector[2]];
}

/** A replicad vector. */
export interface KernelVector {
	toTuple(): [number, number, number];
}

/** A kernel object that holds WebAssembly memory until it is deleted. */
export interface KernelObject {
	delete(): void;
}

/** A replicad edge or wire. */
export interface KernelCurve extends KernelObject {
	readonly geomType: string;
	readonly startPoint: KernelVector;
	/** The point at a position from 0 (start) to 1 (end). */
	pointAt(position: number): KernelVector;
	tangentAt(position: number): KernelVector;
}

/** A replicad face. */
export interface KernelFace {
	readonly geomType: string;
	readonly center: KernelVector;
	readonly edges: KernelCurve[];
	normalAt(): KernelVector;
}

/** A replicad 3D shape (solid, compound, shell). Transformations return a new shape. */
export interface KernelShape extends KernelObject {
	readonly faces: KernelFace[];
	fuse(other: KernelShape): KernelShape;
	cut(tool: KernelShape): KernelShape;
	rotate(angle: number, position: Point3, direction: Point3): KernelShape;
	translate(vector: Point3): KernelShape;
	cutPlane(plane: KernelObject, offset: number, keep: 'positive' | 'negative'): KernelShape | null;
	clone(): KernelShape;
}

/** A replicad 2D drawing, e.g. one half of a projection. */
export interface KernelDrawing {
	toSVGPaths(): string[] | string[][];
}

/** A replicad sketch on a plane, or a sketch made from a closed wire. */
export interface KernelSketch {
	extrude(distance: number): KernelShape;
	revolve(axis: Point3, options: { origin: Point3; angle: number }): KernelShape;
}

/** A closed replicad drawing that can go onto a plane. */
export interface KernelProfile {
	sketchOnPlane(plane: 'XY' | 'XZ'): KernelSketch;
}

/** The replicad drawing pen. */
export interface KernelPen {
	lineTo(point: [number, number]): KernelPen;
	close(): KernelProfile;
}

type ShapeClass = abstract new (...args: never[]) => KernelShape;

/** The replicad functions and classes the engine uses, with the kernel set. */
export interface ReplicadApi {
	setOC(oc: object): void;
	draw(start: [number, number]): KernelPen;
	drawPolysides(radius: number, sides: number): KernelProfile;
	makeBox(corner1: Point3, corner2: Point3): KernelShape;
	makeCylinder(radius: number, height: number, location: Point3, direction: Point3): KernelShape;
	makeSphere(radius: number): KernelShape;
	makeLine(from: Point3, to: Point3): KernelCurve;
	makeThreePointArc(from: Point3, middle: Point3, to: Point3): KernelCurve;
	/** One smooth B-spline edge that passes within `tolerance` of each point. */
	makeBSplineApproximation(points: Point3[], config: { tolerance?: number; degMax?: number; degMin?: number }): KernelCurve;
	makeCircle(radius: number, center: Point3 | KernelVector, normal: Point3 | KernelVector): KernelCurve;
	makeHelix(pitch: number, height: number, radius: number, center: Point3, direction: Point3): KernelCurve;
	assembleWire(edges: KernelCurve[]): KernelCurve;
	genericSweep(profile: KernelCurve, spine: KernelCurve, config: { frenet?: boolean; transitionMode?: 'right' | 'transformed' | 'round' }): KernelShape;
	makeCompound(shapes: KernelShape[]): KernelShape;
	drawProjection(shape: KernelShape, camera: KernelObject): { visible: KernelDrawing; hidden: KernelDrawing };
	readonly ProjectionCamera: new (position: Point3, direction: Point3, xAxis: Point3) => KernelObject;
	/** A sketch from a closed planar wire; it extrudes along +Z by default. */
	readonly Sketch: new (wire: KernelCurve) => KernelSketch;
	readonly Plane: new (origin: Point3, xDirection: null, normal: Point3) => KernelObject;
	readonly Solid: ShapeClass;
	readonly Compound: ShapeClass;
	readonly CompSolid: ShapeClass;
	readonly Shell: ShapeClass;
}

/**
 * The kernel files. The build copies them from `replicad-opencascadejs` to `dist/` (see
 * `script/postinstall.ts`); the glue is renamed `.mjs` because it is an ES module and `dist/`
 * holds CommonJS. The LGPL-2.1 notice ships beside them as `LICENSE-opencascade.txt`.
 */
const KERNEL_GLUE = 'replicad_single.mjs';
const KERNEL_WASM = 'replicad_single.wasm';

let loading: Promise<ReplicadApi> | undefined;

function kernelFiles(): { glue: string; wasm: string } {
	// From source (unit tests) the files are in node_modules; from the bundle they are beside it in dist/.
	if (path.extname(__filename) === '.ts') {
		const packageDir = path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'replicad-opencascadejs', 'dist');
		return { glue: path.join(packageDir, 'replicad_single.js'), wasm: path.join(packageDir, KERNEL_WASM) };
	}
	return { glue: path.join(__dirname, KERNEL_GLUE), wasm: path.join(__dirname, KERNEL_WASM) };
}

/**
 * Loads the OpenCascade kernel (about 23 MB of WebAssembly) and replicad on first use only, and
 * returns the same instance afterwards. Nothing loads at extension activation.
 */
export function loadDrawingKernel(): Promise<ReplicadApi> {
	loading ??= (async () => {
		const files = kernelFiles();
		const glue: { default: (options: { locateFile: (file: string) => string }) => Promise<object> } = await import(pathToFileURL(files.glue).href);
		const oc = await glue.default({ locateFile: () => files.wasm });
		// The specifier is widened to `string` so TypeScript does not load replicad's typings (see the note
		// at the top); esbuild strips the cast and bundles the literal.
		const replicad: ReplicadApi = await import('replicad' as string);
		replicad.setOC(oc);
		return replicad;
	})();
	loading.catch(() => loading = undefined);
	return loading;
}
