/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { checkFigureSvgFaults, checkSceneFaults, DrawingFinding } from '../common/drawingFaults';
import type { DrawingScene, SectionPlane, Vec2, Vec3 } from '../common/drawingScene';
import { layoutFigure, ProjectedPart, ProjectedPort, writeFigureSvg } from '../common/lineArt';
import { flattenSvgPath, pointSegmentDistance, Segment, toSegments } from '../common/planar';
import { CameraBasis, cameraBasis, dot, normalize, projectPoint, resolvePort } from '../common/sceneGeometry';
import { SceneValidationOptions, validateScene } from '../common/sceneValidator';
import { KernelDrawing, KernelObject, KernelShape, loadDrawingKernel, point3, ReplicadApi } from './drawingKernel';
import { buildPart } from './sceneSolids';

/** Options of one Figure render. */
export interface RenderFigureOptions extends SceneValidationOptions {
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

function drawingLines(drawing: KernelDrawing): Vec2[][] {
	let paths: string[] | string[][];
	try {
		paths = drawing.toSVGPaths();
	} catch {
		// An empty projection has no paths.
		return [];
	}
	return paths.flat().flatMap(d => flattenSvgPath(d, 24));
}

function project(r: ReplicadApi, shape: KernelShape, camera: CameraBasis): { visible: Vec2[][]; hidden: Vec2[][] } {
	const projection = r.drawProjection(shape, new r.ProjectionCamera([0, 0, 0], point3(camera.direction), point3(camera.xAxis)));
	return { visible: drawingLines(projection.visible), hidden: drawingLines(projection.hidden) };
}

function sectionNormal(section: SectionPlane): Vec3 {
	const named: Record<string, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
	const raw = typeof section.normal === 'string' ? named[section.normal] : section.normal;
	return normalize(raw) ?? [0, 0, 1];
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

/** Assigns each edge of the whole-scene projection to the part whose own projection lies under it. */
function attribute(lines: readonly Vec2[][], solo: readonly { id: string; segments: Segment[] }[]): Map<string, Vec2[][]> {
	const result = new Map<string, Vec2[][]>(solo.map(part => [part.id, []]));
	for (const line of lines) {
		let best: string | undefined;
		let bestDistance = Infinity;
		for (const part of solo) {
			let total = 0;
			for (const point of line) {
				let nearest = Infinity;
				for (const segment of part.segments) {
					nearest = Math.min(nearest, pointSegmentDistance(point, segment));
					if (nearest < 1e-6) {
						break;
					}
				}
				total += nearest;
				if (total >= bestDistance) {
					break;
				}
			}
			if (total < bestDistance) {
				bestDistance = total;
				best = part.id;
			}
		}
		if (best !== undefined) {
			result.get(best)!.push(line);
		}
	}
	return result;
}

/** Builds the solids, cuts the section, projects with hidden-line removal and returns the parts. */
async function projectScene(scene: DrawingScene, camera: CameraBasis): Promise<ProjectedPart[]> {
	const r = await loadDrawingKernel();
	const owned: KernelObject[] = [];
	try {
		const solids: { id: string; shape: KernelShape }[] = [];
		for (const part of scene.parts) {
			let shape: KernelShape | null = buildPart(r, part);
			if (scene.section) {
				const plane = new r.Plane(point3(scene.section.origin), null, point3(sectionNormal(scene.section)));
				owned.push(plane);
				shape = shape.cutPlane(plane, 0, scene.section.keep ?? 'positive');
			}
			if (shape) {
				owned.push(shape);
				solids.push({ id: part.id, shape });
			}
		}
		const solo = solids.map(({ id, shape }) => {
			const own = project(r, shape, camera);
			return { id, own, cut: scene.section ? cutFaces(shape, scene.section, camera) : [], segments: toSegments([...own.visible, ...own.hidden]) };
		});
		if (solids.length === 1) {
			return solo.map(part => ({ id: part.id, visible: part.own.visible, hidden: part.own.hidden, cutFaces: part.cut }));
		}
		const compound = r.makeCompound(solids.map(solid => solid.shape.clone()));
		owned.push(compound);
		const whole = project(r, compound, camera);
		const visible = attribute(whole.visible, solo);
		const hidden = attribute(whole.hidden, solo);
		return solo.map(part => ({ id: part.id, visible: visible.get(part.id) ?? [], hidden: hidden.get(part.id) ?? [], cutFaces: part.cut }));
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
	const validation = validateScene(input, options);
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
		const point = resolvePort(port, partsById.get(port.part), camera);
		return { numeral: port.numeral, part: port.part, surface: port.surface === true, anchor: point && projectPoint(camera, point) };
	});
	const svg = writeFigureSvg(layoutFigure({ figure: scene.figure, parts, ports, hiddenEdges: scene.hiddenEdges ?? 'omit', scale: scene.scale }));
	findings.push(...checkFigureSvgFaults(svg, `${scene.figure}.svg`));
	return { svg, findings };
}
