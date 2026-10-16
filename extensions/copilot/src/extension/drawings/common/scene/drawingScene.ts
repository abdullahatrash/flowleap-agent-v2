/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The scene of one Figure, `FIG-N.scene.json` (ADR 0014 decision 1). The scene is the source of
 * truth: the SVG line art and the sheets are derived from it and regenerate.
 *
 * Coordinates are model millimetres, right-handed, Z up. The front of the object faces -Y, so
 * the `front` camera looks along +Y. Every shape is built in its part-local frame and then moved
 * by its placement.
 */
export interface DrawingScene {
	/** The Figure the scene draws, e.g. `FIG-1`. */
	readonly figure: string;
	/** The view of the Figure. */
	readonly camera: CameraPreset;
	/** `omit` (the default) drops hidden edges; `dashed` draws them as thin dashed lines. */
	readonly hiddenEdges?: 'omit' | 'dashed';
	/**
	 * A section plane: the parts are cut and the cut faces are hatched. Adjacent cut faces get
	 * different hatch styles. A part with `sectioned: false` is drawn whole, with no hatch.
	 */
	readonly section?: SectionPlane;
	/** Sheet millimetres per model millimetre. Omit it to fit the Figure to the default size. */
	readonly scale?: number;
	readonly parts: readonly ScenePart[];
	readonly numerals: readonly NumeralPort[];
}

/** The camera presets. Isometric looks from the front, right and top corner. */
export type CameraPreset = 'isometric' | 'front' | 'top' | 'side';

/** All camera presets, in the order the schema documents them. */
export const CAMERA_PRESETS: readonly CameraPreset[] = ['isometric', 'front', 'top', 'side'];

export type Vec3 = readonly [number, number, number];

export type Vec2 = readonly [number, number];

/** A three-point arc from the previous point through `through` to `arc`. */
export interface ArcSegment {
	readonly arc: Vec2;
	readonly through: Vec2;
}

/** A smooth curve from the previous point through each point, ending at the last. */
export interface SplineSegment {
	readonly spline: readonly Vec2[];
}

/**
 * One item of a closed 2D profile: a plain point (a straight segment from the previous point),
 * an arc segment or a spline segment. The first item is always a plain point. The profile closes
 * with a straight segment from the last point back to the first, unless they are the same point.
 */
export type ProfileItem = Vec2 | ArcSegment | SplineSegment;

/** A plane that cuts every part. The kept half is on the side the normal points to by default. */
export interface SectionPlane {
	/** A point on the plane, in model coordinates. */
	readonly origin: Vec3;
	/** The plane normal: an axis name or a vector. */
	readonly normal: 'x' | 'y' | 'z' | Vec3;
	/** The half of each part that stays. Default `positive` (the normal side). */
	readonly keep?: 'positive' | 'negative';
}

/** Rotation in degrees about the X, then Y, then Z axis, then a translation. */
export interface Placement {
	readonly translate?: Vec3;
	readonly rotate?: Vec3;
}

/** One drawn part. Every part must carry at least one numeral (CONTEXT.md, Figure). */
export interface ScenePart {
	/** A stable id the numeral ports refer to, e.g. `housing`. Never drawn. */
	readonly id: string;
	/** The part name from the figures list. Never drawn. */
	readonly name?: string;
	readonly shape: PartShape;
	readonly placement?: Placement;
	/** Primitives cut out of the shape, in the part-local frame (holes, slots, bores). */
	readonly subtract?: readonly PlacedPrimitive[];
	/**
	 * False draws the part whole through a section, with no hatch. Default true, except a `shaft`,
	 * `fastener` or `spring` that the section plane cuts along its axis (ASME Y14.3 convention).
	 */
	readonly sectioned?: boolean;
	/** The hatch style of the cut face. Omit it to let the engine pick one that differs from the neighbours. */
	readonly hatch?: HatchOverride;
}

/** A hatch angle on the sheet, in degrees counter-clockwise from the x axis. */
export type HatchAngle = 45 | 135;

/** A part's hatch override; each omitted field takes its default (45 degrees, 2 mm). */
export interface HatchOverride {
	readonly angle?: HatchAngle;
	/** Line pitch in sheet millimetres, from `HATCH_PITCH_MIN` to `HATCH_PITCH_MAX`. */
	readonly pitch?: number;
}

/** The hatch angles a scene may give. */
export const HATCH_ANGLES: readonly HatchAngle[] = [45, 135];
/** The hatch pitch range in sheet millimetres. */
export const HATCH_PITCH_MIN = 1.5;
export const HATCH_PITCH_MAX = 3;

/** The library kinds that stay unsectioned when the section plane runs along their axis. */
export const UNSECTIONED_KINDS: readonly LibraryShape['kind'][] = ['shaft', 'fastener', 'spring'];

/** A primitive with its own placement in the part-local frame. */
export interface PlacedPrimitive {
	readonly shape: PrimitiveShape;
	readonly placement?: Placement;
}

export type PartShape = PrimitiveShape | LibraryShape | CodeShape;

export type PrimitiveShape = BoxShape | CylinderShape | ExtrudedPolygonShape | RevolveShape | TubeShape;

export type LibraryShape = FastenerShape | SpringShape | GearShape | BearingShape | ShaftShape | PipeShape | MotorShape | CamShape;

/** A box from the origin to `size`. Faces: top, bottom, front, back, left, right. */
export interface BoxShape {
	readonly kind: 'box';
	readonly size: Vec3;
}

/** A cylinder on the Z axis from z = 0 to z = height. Faces: top, bottom, side, axis. */
export interface CylinderShape {
	readonly kind: 'cylinder';
	readonly radius: number;
	readonly height: number;
}

/**
 * A closed profile in the XY plane extruded along +Z. Faces: top, bottom, side-1 … side-N, axis (the
 * Z axis). Side i is the segment that ends at item i + 1 (an arc or a spline is one side); the
 * closing segment is last.
 */
export interface ExtrudedPolygonShape {
	readonly kind: 'extrudedPolygon';
	readonly points: readonly ProfileItem[];
	readonly height: number;
}

/**
 * A profile of (radius, z) items revolved about the Z axis. The profile is closed from the last
 * point back to the first. Faces: profile-1 … profile-N, numbered as the sides of an extrudedPolygon, axis.
 */
export interface RevolveShape {
	readonly kind: 'revolve';
	readonly profile: readonly ProfileItem[];
	/** Revolve angle in degrees, default 360. */
	readonly degrees?: number;
}

/**
 * A round tube through straight segments and bends. The path is a polyline; each inner corner
 * is rounded with `bendRadius`. Faces: segment-1 … segment-N.
 */
export interface TubeShape {
	readonly kind: 'tube';
	readonly path: readonly Vec3[];
	readonly radius: number;
	readonly bendRadius: number;
	/** Wall thickness. Omit it for a solid rod. */
	readonly wall?: number;
}

/** A bolt on the Z axis: head from z = 0 up, shank from z = 0 down. Ports: head, shank, tip. */
export interface FastenerShape {
	readonly kind: 'fastener';
	readonly diameter: number;
	readonly length: number;
	readonly head?: 'hex' | 'round';
}

/** A helical compression spring on the Z axis from z = 0. Ports: top, bottom, coil. */
export interface SpringShape {
	readonly kind: 'spring';
	readonly coilDiameter: number;
	readonly wireDiameter: number;
	readonly pitch: number;
	readonly length: number;
}

/** A spur gear on the Z axis from z = 0. Ports: teeth, face, bore. */
export interface GearShape {
	readonly kind: 'gear';
	readonly teeth: number;
	readonly module: number;
	readonly width: number;
	readonly bore?: number;
}

/** A ball bearing ring pair on the Z axis from z = 0. Ports: outer-race, inner-race, face. */
export interface BearingShape {
	readonly kind: 'bearing';
	readonly innerDiameter: number;
	readonly outerDiameter: number;
	readonly width: number;
}

/**
 * A stepped shaft on the Z axis from z = 0. The first step is the base diameter and length; more
 * steps follow along +Z. Ports: end-1, end-2, step-1 … step-N, axis.
 */
export interface ShaftShape {
	readonly kind: 'shaft';
	readonly steps: readonly { readonly diameter: number; readonly length: number }[];
}

/** A straight pipe on the Z axis from z = 0. Ports: outer, bore, end-1, end-2. */
export interface PipeShape {
	readonly kind: 'pipe';
	readonly outerDiameter: number;
	readonly wall: number;
	readonly length: number;
}

/** A motor can on the Z axis from z = 0, the output shaft along +Z. Ports: body, face, shaft. */
export interface MotorShape {
	readonly kind: 'motor';
	readonly diameter: number;
	readonly length: number;
	readonly shaftDiameter: number;
	readonly shaftLength: number;
}

/** One lobe of a cam: a smooth bump of `lift` centred at `angle`, `width` degrees wide. */
export interface CamLobe {
	/** The lobe centre, in degrees from +X towards +Y. */
	readonly angle: number;
	/** The rise of the lobe above the base circle. */
	readonly lift: number;
	/** The angle the lobe spans, in degrees. */
	readonly width: number;
}

/**
 * A plate cam on the Z axis from z = 0 to z = height: a base circle with smooth lobes. Ports: top,
 * bottom, axis (the centre of the top face), lobe-1 … lobe-N (the point of maximum lift),
 * land-1 … land-N (the middle of the base arc from lobe i to lobe i + 1).
 */
export interface CamShape {
	readonly kind: 'cam';
	/** The base circle radius. */
	readonly base: number;
	readonly lobes: readonly CamLobe[];
	readonly height: number;
}

/**
 * The per-part code escape hatch, for a shape the primitives cannot express. OPT-IN: the engine
 * refuses it unless the caller passes `allowCode`. The code is the body of a function that gets
 * only the replicad API as `replicad` and returns one solid; it runs in a separate VM context with
 * no `require`, `process` or file system. A numeral port on a code part must give its `point`.
 */
export interface CodeShape {
	readonly kind: 'code';
	readonly code: string;
}

/**
 * A reference numeral and the port it points at: a (part, face, point) triple. The renderer
 * computes the lead line from the numeral to the projected point and keeps lead lines from
 * crossing; the model never places a numeral by coordinates.
 */
export interface NumeralPort {
	/** The reference numeral, e.g. `10`, `12a`. */
	readonly numeral: string;
	/** The part id. */
	readonly part: string;
	/** A face or port name of the part (see the shape kinds). */
	readonly face: string;
	/** A point on the face in the part-local frame. Omit it to use the face anchor. */
	readonly point?: Vec3;
	/** True when the numeral names a surface: it sits on the surface, underlined, without a lead line. */
	readonly surface?: boolean;
	/**
	 * `centre` draws a centre mark (a thin cross) at the port and ends the lead line on one arm of
	 * the cross. Use it for an axis or a centre point that has no edge to end on. The `axis` port
	 * sets it without this field.
	 */
	readonly mark?: 'centre';
}

/** The library part kinds, in schema order. */
export const LIBRARY_KINDS: readonly LibraryShape['kind'][] = ['fastener', 'spring', 'gear', 'bearing', 'shaft', 'pipe', 'motor', 'cam'];

/** The primitive kinds, in schema order. */
export const PRIMITIVE_KINDS: readonly PrimitiveShape['kind'][] = ['box', 'cylinder', 'extrudedPolygon', 'revolve', 'tube'];
