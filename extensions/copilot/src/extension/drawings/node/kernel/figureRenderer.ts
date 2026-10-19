/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { checkFigureSvgFaults, checkSceneFaults, DrawingFinding } from '../../common/scene/drawingFaults';
import type { DrawingScene, HatchOverride, SectionPlane, Vec2 } from '../../common/scene/drawingScene';
import { figureScale, layoutFigure, ProjectedPart, ProjectedPort, SHEET_CHORD_TOLERANCE, writeFigureSvg } from '../../common/lineArt/lineArt';
import { flattenSvgPath, pointSegmentDistance, Segment, toSegments } from '../../common/lineArt/planar';
import { cameraBasis, CameraBasis, dot, hasCentreMark, isPortEdgeOn, isSectioned, projectedAxis, projectPoint, resolvePort, sectionNormal } from '../../common/scene/sceneGeometry';
import { validateScene } from '../../common/scene/sceneValidator';
import { KernelDrawing, KernelObject, KernelShape, loadDrawingKernel, point3, ReplicadApi } from './drawingKernel';
import { buildPart } from './sceneSolids';

/** Options of one Figure render. */
export interface RenderFigureOptions {
	/** The numerals of the figures list. Omit it to skip the allowed-set check. */
	readonly allowedNumerals?: readonly string[];
}

/** The result of one Figure render: the SVG when the scene built, and every Finding. */
export interface RenderedFigure {
	readonly svg?: string;
	readonly findings: readonly DrawingFinding[];
}

/** Samples per curved edge when a section face is turned into polylines. */
const CURVE_SAMPLES = 32;

/** The SVG path data of one half of a projection. The kernel writes curves as `C` and `A` commands. */
function drawingPaths(drawing: KernelDrawing): string[] {
	try {
		return drawing.toSVGPaths().flat();
	} catch {
		// An empty projection has no paths.
		return [];
	}
}

/** One projection as SVG path data, before it is flattened. */
interface ProjectedPaths {
	readonly visible: string[];
	readonly hidden: string[];
}

function project(r: ReplicadApi, shape: KernelShape, camera: CameraBasis): ProjectedPaths {
	const projection = r.drawProjection(shape, new r.ProjectionCamera([0, 0, 0], point3(camera.direction), point3(camera.xAxis)));
	return { visible: drawingPaths(projection.visible), hidden: drawingPaths(projection.hidden) };
}

/** The flattened projection of one shape. */
interface FlatProjection {
	readonly visible: Vec2[][];
	readonly hidden: Vec2[][];
}

/**
 * Turns projected curves into polylines fine enough for the sheet. A first coarse pass gives the
 * drawing span and so the sheet scale; the curves are then flattened to a chord error of
 * SHEET_CHORD_TOLERANCE at that scale. The sheet layout can only shrink a Figure, which makes the
 * error smaller still. `tolerance` is that chord error in model millimetres.
 */
function flattener(paths: readonly ProjectedPaths[], scale: number | undefined): { flatten: (projection: ProjectedPaths) => FlatProjection; tolerance: number } {
	const coarse = paths.flatMap(projection => [...projection.visible, ...projection.hidden]).flatMap(d => flattenSvgPath(d, 4)).flat();
	const span = (axis: 0 | 1) => coarse.length ? Math.max(...coarse.map(point => point[axis])) - Math.min(...coarse.map(point => point[axis])) : 0;
	const tolerance = SHEET_CHORD_TOLERANCE / figureScale(span(0), span(1), scale);
	const flatten = (d: string) => flattenSvgPath(d, 24, tolerance);
	return { flatten: projection => ({ visible: projection.visible.flatMap(flatten), hidden: projection.hidden.flatMap(flatten) }), tolerance };
}

/** The faces of a cut solid that lie on the section plane, as projected polylines. */
function cutFaces(shape: KernelShape, section: SectionPlane, camera: CameraBasis): Vec2[][] {
	const normal = sectionNormal(section);
	const offset = dot(section.origin, normal);
	const loops: Vec2[][] = [];
	for (const face of shape.faces) {
		if (face.geomType !== 'PLANE') {
			continue;
		}
		const faceNormal = face.normalAt().toTuple();
		const centre = face.center.toTuple();
		if (Math.abs(Math.abs(dot(faceNormal, normal)) - 1) > 1e-6 || Math.abs(dot(centre, normal) - offset) > 1e-4) {
			continue;
		}
		for (const edge of face.edges) {
			const samples = edge.geomType === 'LINE' ? 1 : CURVE_SAMPLES;
			const line: Vec2[] = [];
			for (let i = 0; i <= samples; i++) {
				line.push(projectPoint(camera, edge.pointAt(i / samples).toTuple()));
			}
			loops.push(line);
		}
	}
	return loops;
}

/** The distance from a point to the nearest segment of one part's own projection. */
function distanceToPart(point: Vec2, segments: readonly Segment[]): number {
	let nearest = Infinity;
	for (const segment of segments) {
		nearest = Math.min(nearest, pointSegmentDistance(point, segment));
		if (nearest < 1e-6) {
			break;
		}
	}
	return nearest;
}

/**
 * The parts of `piece` that no segment of `kept` already draws: a kept segment that lies on the
 * line of `piece` (within `tolerance`) removes the stretch it covers.
 */
function uncovered(piece: Segment, kept: readonly Segment[], tolerance: number): Segment[] {
	const [from, to] = piece;
	const direction: Vec2 = [to[0] - from[0], to[1] - from[1]];
	const length = Math.hypot(direction[0], direction[1]);
	if (length < 1e-9) {
		return [];
	}
	const along = (point: Vec2) => ((point[0] - from[0]) * direction[0] + (point[1] - from[1]) * direction[1]) / (length * length);
	const across = (point: Vec2) => Math.abs((point[0] - from[0]) * direction[1] - (point[1] - from[1]) * direction[0]) / length;
	// A stretch that the clip shortened is dropped when it is shorter than `tolerance`; a whole piece stays.
	let free: [number, number][] = [[0, 1]];
	for (const other of kept) {
		// Two overlapping segments on one line: an end of one lies on the other.
		const touches = pointSegmentDistance(other[0], piece) <= tolerance || pointSegmentDistance(other[1], piece) <= tolerance || pointSegmentDistance(from, other) <= tolerance || pointSegmentDistance(to, other) <= tolerance;
		if (!touches || across(other[0]) > tolerance || across(other[1]) > tolerance) {
			continue;
		}
		const [start, end] = [along(other[0]), along(other[1])].sort((x, y) => x - y);
		free = free.flatMap(([s0, s1]): [number, number][] => [[s0, Math.min(s1, start)], [Math.max(s0, end), s1]]).filter(([s0, s1]) => (s0 === 0 && s1 === 1) || (s1 - s0) * length > tolerance);
		if (!free.length) {
			break;
		}
	}
	const at = (t: number): Vec2 => [from[0] + t * direction[0], from[1] + t * direction[1]];
	return free.map(([s0, s1]): Segment => [at(s0), at(s1)]);
}

/**
 * Gives each piece of the whole-scene projection to the part whose own projection lies under it.
 * The whole-scene projection chains the edges of touching parts into one line: one line can run
 * around two parts, or around a groove in each of two parts. So the line is split, piece by piece.
 * A piece goes to the part nearest to its two ends and its middle. Where two parts share a boundary,
 * both are near; the piece then stays with the part of the piece before it (within the chord error
 * `tolerance`), and else with the first part in scene order. Two touching solids can also each give
 * an edge on the shared boundary; the stretch that an earlier piece already draws is dropped. So a
 * shared boundary is drawn once, by one part.
 */
function attribute(lines: readonly Vec2[][], solo: readonly { id: string; segments: Segment[] }[], tolerance: number): Map<string, Vec2[][]> {
	const result = new Map<string, Vec2[][]>(solo.map(part => [part.id, []]));
	const distances = (point: Vec2) => solo.map(part => distanceToPart(point, part.segments));
	const kept: Segment[] = [];
	for (const line of lines) {
		const atPoints = line.map(distances);
		let owner = -1;
		let run: Vec2[] = [];
		const close = () => {
			if (owner >= 0 && run.length >= 2) {
				result.get(solo[owner].id)!.push(run);
			}
			run = [];
		};
		for (let i = 1; i < line.length; i++) {
			const [from, to] = [line[i - 1], line[i]];
			const atMiddle = distances([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
			const piece = solo.map((_, k) => Math.max(atPoints[i - 1][k], atPoints[i][k], atMiddle[k]));
			let best = owner;
			for (let k = 0; k < solo.length; k++) {
				if (piece[k] < (best < 0 ? Infinity : piece[best] - (best === owner ? tolerance : 0))) {
					best = k;
				}
			}
			if (best !== owner) {
				close();
				owner = best;
			}
			for (const [start, end] of uncovered([from, to], kept, tolerance)) {
				const last = run[run.length - 1];
				if (!last || last[0] !== start[0] || last[1] !== start[1]) {
					close();
					run = [start];
				}
				run.push(end);
			}
			kept.push([from, to]);
		}
		close();
	}
	return result;
}

/**
 * Builds the solids, cuts the section, projects with hidden-line removal and returns the parts.
 * An unsectioned part that the plane does not remove stays whole: it has no cut face, and its
 * outline covers the cut faces behind it.
 */
async function projectScene(scene: DrawingScene, camera: CameraBasis): Promise<ProjectedPart[]> {
	const r = await loadDrawingKernel();
	const owned: KernelObject[] = [];
	try {
		const solids: { id: string; shape: KernelShape; sectioned: boolean; hatch?: HatchOverride }[] = [];
		for (const part of scene.parts) {
			const whole = buildPart(r, part);
			owned.push(whole);
			let shape: KernelShape | null = whole;
			const sectioned = scene.section !== undefined && isSectioned(part, scene.section);
			if (scene.section) {
				const plane = new r.Plane(point3(scene.section.origin), null, point3(sectionNormal(scene.section)));
				owned.push(plane);
				const cut = whole.cutPlane(plane, 0, scene.section.keep ?? 'positive');
				if (cut) {
					owned.push(cut);
				}
				// The plane removes a part wholly on the far side, sectioned or not.
				shape = cut && !sectioned ? whole : cut;
			}
			if (shape) {
				solids.push({ id: part.id, shape, sectioned, hatch: part.hatch });
			}
		}
		const soloPaths = solids.map(({ shape }) => project(r, shape, camera));
		const { flatten, tolerance } = flattener(soloPaths, scene.scale);
		const solo = solids.map(({ id, shape, sectioned, hatch }, index) => {
			const own = flatten(soloPaths[index]);
			return { id, own, hatch, cut: scene.section && sectioned ? cutFaces(shape, scene.section, camera) : [], segments: toSegments([...own.visible, ...own.hidden]) };
		});
		if (solids.length === 1) {
			return solo.map(part => ({ id: part.id, visible: part.own.visible, hidden: part.own.hidden, cutFaces: part.cut, hatch: part.hatch }));
		}
		const compound = r.makeCompound(solids.map(solid => solid.shape.clone()));
		owned.push(compound);
		const whole = flatten(project(r, compound, camera));
		const visible = attribute(whole.visible, solo, tolerance);
		const hidden = attribute(whole.hidden, solo, tolerance);
		return solo.map(part => ({ id: part.id, visible: visible.get(part.id) ?? [], hidden: hidden.get(part.id) ?? [], cutFaces: part.cut, hatch: part.hatch }));
	} finally {
		for (const item of owned) {
			try {
				item.delete();
			} catch {
				// Already consumed by a kernel operation.
			}
		}
	}
}

/**
 * Renders one Figure from its scene: validate, build the solids on the kernel, cut the section,
 * project with exact hidden-line removal, lay out the line art and the numerals, write `FIG-N.svg`,
 * then run the mechanical fault list on the scene and on the written SVG. No model call.
 */
export async function renderFigure(input: unknown, options: RenderFigureOptions = {}): Promise<RenderedFigure> {
	const validation = validateScene(input);
	if (!validation.scene) {
		return { findings: validation.findings };
	}
	const scene = validation.scene;
	const findings: DrawingFinding[] = [...checkSceneFaults(scene, options.allowedNumerals)];
	const camera = cameraBasis(scene.camera);
	let parts: ProjectedPart[];
	try {
		parts = await projectScene(scene, camera);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		findings.push({ severity: 'Error', rule: 'scene-build', message: `The kernel could not build the scene: ${message}`, citation: 'ADR 0014 decision 2 (OpenCascade through replicad)', file: `${scene.figure}.scene.json` });
		return { findings };
	}
	const partsById = new Map(scene.parts.map(part => [part.id, part]));
	const ports: ProjectedPort[] = scene.numerals.map(port => {
		const part = partsById.get(port.part);
		const point = resolvePort(port, part, camera);
		return { numeral: port.numeral, part: port.part, surface: port.surface === true, anchor: point && projectPoint(camera, point), mark: hasCentreMark(port), edgeOn: isPortEdgeOn(port, part, camera), centreLine: port.centreLine === true && part && hasCentreMark(port) ? projectedAxis(part, camera) : undefined };
	});
	const svg = writeFigureSvg(layoutFigure({ figure: scene.figure, parts, ports, hiddenEdges: scene.hiddenEdges ?? 'omit', scale: scene.scale }));
	findings.push(...checkFigureSvgFaults(svg, { file: `${scene.figure}.svg` }));
	return { svg, findings };
}
