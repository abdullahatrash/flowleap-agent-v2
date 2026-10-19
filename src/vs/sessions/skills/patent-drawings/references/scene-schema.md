# Scene schema

One file per Figure: `drafting/<matter>/drawings/FIG-N.scene.json`. The scene is
the source of truth. The SVG line art and the Drawing Sheets are made from it
and are made again on each render. The engine reads the scene; it never reads
the model's idea of the picture.

## Frame

- Units are model millimetres. Right-handed. Z is up.
- The front of the object faces -Y. The `front` camera looks along +Y.
- Each shape is built in its own part frame, then moved by its `placement`.
- `placement.rotate` is degrees about X, then Y, then Z. `placement.translate`
  is applied after the rotation.

## Top level

| Field | Required | Value |
|---|---|---|
| `figure` | no | `"FIG-N"` or `"FIG-NA"`. The render sets it from the Figure number you give. |
| `camera` | yes | `isometric`, `front`, `top` or `side`. Isometric looks from the front, right and top corner. |
| `parts` | yes | a non-empty array of parts |
| `numerals` | yes | an array of numeral ports |
| `hiddenEdges` | no | `omit` (default) or `dashed` |
| `section` | no | `{ "origin": [x, y, z], "normal": "x" \| "y" \| "z" \| [x, y, z], "keep": "positive" \| "negative" }`. The parts are cut and the cut faces are hatched. Touching cut faces get different hatch styles. See `sectioned` and `hatch` below. |
| `scale` | no | sheet mm per model mm. Omit it to fit the default size. |

## Part

```json
{ "id": "housing", "name": "housing", "shape": { "kind": "box", "size": [60, 40, 20] },
  "placement": { "translate": [0, 0, 0], "rotate": [0, 0, 0] },
  "subtract": [ { "shape": { "kind": "cylinder", "radius": 8, "height": 22 }, "placement": { "translate": [30, 20, -1] } } ] }
```

- `id`: an identifier such as `housing`. Unique in the scene. Never drawn.
- `name`: the part name from `figures.md`. Never drawn. Two parts with the same
  `name` are the same part for the numeral check.
- `subtract`: primitives cut out of the shape, in the part frame (holes,
  slots, bores). Only primitives, not library parts.
- `sectioned`: `true` or `false`. Used only with a `section`. `false` draws
  the part whole through the cut, with its full outline and no hatch. The
  default is `true`. Exception: a `shaft`, `fastener` or `spring` is not
  sectioned when the plane runs along its axis (drafting convention). When
  the plane cuts it across, it is sectioned. Set `sectioned` to change the
  default, for example `false` for a pin or key built from a primitive.
- `hatch`: `{ "angle": 45 | 135, "pitch": 1.5 to 3 }`. Used only with a
  `section`. `pitch` is the line spacing in sheet mm. An omitted field takes
  its default (45°, 2 mm). Omit `hatch` normally: the engine gives each
  sectioned part a style that differs from every part it touches. It tries
  45° 2 mm, 135° 2 mm, 45° 1.5 mm, 135° 1.5 mm, 45° 3 mm, 135° 3 mm, in
  this order. Parts with a `hatch` are set first; the other parts avoid them.
  Give the same `hatch` to two separate parts of one item (37 CFR 1.84(h)(3)).

## Primitives

Faces in the right column are the names a numeral port can use.

| Kind | Fields | Faces |
|---|---|---|
| `box` | `size: [x, y, z]`, from the origin | `top`, `bottom`, `front`, `back`, `left`, `right` |
| `cylinder` | `radius`, `height`; on Z from z = 0 | `top`, `bottom`, `side`, `axis` |
| `extrudedPolygon` | `points: [[x, y], ...]` in the XY plane (points and curved segments, see below), `height` along +Z | `top`, `bottom`, `side-1` ... `side-N` (segment i, see below), `axis` (the Z axis of the part frame) |
| `revolve` | `profile: [[r, z], ...]` closed back to the first point (points and curved segments), `degrees` (default 360); about Z; every r ≥ 0 | `profile-1` ... `profile-N` (segment i, see below), `axis` |
| `tube` | `path: [[x, y, z], ...]`, `radius`, `bendRadius`, `wall` (omit for a solid rod; less than `radius`) | `segment-1` ... `segment-N` |

```json
{ "kind": "box", "size": [40, 30, 5] }
{ "kind": "cylinder", "radius": 5, "height": 20 }
{ "kind": "extrudedPolygon", "points": [[0, 0], [20, 0], [20, 5], [5, 5], [5, 20], [0, 20]], "height": 10 }
{ "kind": "revolve", "profile": [[0, 0], [8, 0], [8, 4], [4, 10], [0, 10]] }
{ "kind": "tube", "path": [[0, 0, 0], [30, 0, 0], [30, 30, 0], [30, 30, 20]], "radius": 3, "bendRadius": 8, "wall": 1 }
```

### Curved segments in `points` and `profile`

A plain point `[x, y]` draws a straight segment from the previous point. Two
other items draw a curve from the previous point:

- `{ "arc": [x, y], "through": [mx, my] }`: a circular arc that goes through
  `through` and ends at `arc`. The three points must be different and not on
  one line.
- `{ "spline": [[x, y], ...] }`: a smooth curve through each point, ending at
  the last. Give at least 2 points.

The first item is always a plain point. The profile closes with a straight
segment back to the first point. When the last point is the first point, there
is no closing segment. Each item after the first is one side: an arc or a
spline is one face (`side-i`, `profile-i`), not one face per point. The
closing segment is the last side. Use curves for a round outline. Never
approximate a curve with many straight points: the facets show on the sheet.

```json
{ "kind": "extrudedPolygon", "points": [[0, 0], [20, 0], { "arc": [20, 20], "through": [30, 10] }, { "spline": [[10, 25], [0, 20]] }], "height": 3 }
```

Here `side-1` is the bottom edge, `side-2` the arc, `side-3` the spline and
`side-4` the closing edge from (0, 20) to (0, 0).

## Library parts

Use a library part for every standard part. Its ports are in
[part-library.md](part-library.md).

```json
{ "kind": "fastener", "diameter": 6, "length": 20, "head": "hex" }
{ "kind": "spring", "coilDiameter": 16, "wireDiameter": 2, "pitch": 5, "length": 30 }
{ "kind": "gear", "teeth": 12, "module": 2, "width": 6, "bore": 5 }
{ "kind": "bearing", "innerDiameter": 10, "outerDiameter": 26, "width": 8 }
{ "kind": "shaft", "steps": [{ "diameter": 8, "length": 10 }, { "diameter": 12, "length": 15 }] }
{ "kind": "pipe", "outerDiameter": 14, "wall": 2, "length": 30 }
{ "kind": "motor", "diameter": 28, "length": 30, "shaftDiameter": 4, "shaftLength": 10 }
{ "kind": "cam", "base": 6, "lobes": [{ "angle": 0, "lift": 4, "width": 100 }], "height": 6 }
```

## The `code` kind

`{ "kind": "code", "code": "..." }` is an opt-in escape hatch. The drawing
tools and the drawings CLI do not opt in, so a scene with a `code` part is
refused (`code-not-allowed`). When a shape needs it, the shape is out of scope:
see [scope-and-refusals.md](scope-and-refusals.md).

## Numeral ports

```json
{ "numeral": "10", "part": "housing", "face": "front" }
{ "numeral": "12", "part": "housing", "face": "top", "point": [12, 10, 20], "surface": true }
```

| Field | Required | Value |
|---|---|---|
| `numeral` | yes | digits, an optional lower-case letter and an optional prime: `10`, `12a`, `14'` |
| `part` | yes | a part `id` |
| `face` | yes | a face or port name of that part's shape |
| `point` | no | a point on the face in the part frame. Omit it to use the face anchor. |
| `surface` | no | `true` when the numeral names a surface: it sits on the surface, underlined, with no lead line |
| `mark` | no | `"centre"` draws a centre mark (a thin cross, 3 mm arms) at the port. The lead line ends on one arm. Use it for a centre point that has no edge. The `axis` port sets it for you. |
| `centreLine` | no | `true` draws a thin chain centre line (long dash, short dash) through the port, across the part's outline and 2 mm beyond it. Needs the `axis` port or `mark: "centre"` on a part that has an axis (cylinder, extrudedPolygon, revolve, shaft, cam). A part seen across its axis gets one line along the axis; a part seen along its axis gets two crossing lines. The line is not a lead line. |

You never place a numeral by sheet coordinates. The engine computes the lead
line from the port and keeps lead lines from crossing.

A lead line always ends on a visible edge or on a centre mark:

- A port on a face that the camera sees flat-on: the lead ends on the nearest
  visible edge of the part and comes from outside the face.
- A port on a face that the camera sees edge-on (the face is a line): the lead
  meets that line at 30° to 60°. It never runs along an edge.
- An axis or a centre point: use the `axis` port or `mark: "centre"`. The lead
  ends on an arm of the centre mark.
- A pin or a shaft seen across its axis, or a round part seen along it: add
  `centreLine: true` to that port. The engine draws the chain centre line and
  the lead still ends on the centre mark.

The numeral of a centre mark, or of a feature more than 8 mm inside the
part's outline, goes inside the outline, 5 mm to 8 mm from the feature, with a
short lead that crosses no edge. Only when no inside position is free does it go
outside the drawing.

## Example: a whole scene

```json
{
	"figure": "FIG-2",
	"camera": "front",
	"section": { "origin": [0, 0, 0], "normal": "y", "keep": "positive" },
	"parts": [
		{ "id": "bushing", "name": "bushing", "shape": { "kind": "revolve", "profile": [[10, 0], [25, 0], [25, 8], [16, 8], [16, 40], [10, 40]] } }
	],
	"numerals": [
		{ "numeral": "20", "part": "bushing", "face": "profile-2", "point": [25, 0, 4] },
		{ "numeral": "22", "part": "bushing", "face": "profile-4", "point": [16, 0, 30] }
	]
}
```
