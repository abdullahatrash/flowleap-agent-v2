# Part library

Eight parametric parts. Use one for every standard part in the figures list.
Never build a bolt, spring, gear, bearing, shaft, pipe, motor or cam from
primitives. All library parts stand on the Z axis from z = 0 in their part
frame; rotate them with `placement.rotate`.

In a section view, a `shaft`, `fastener` or `spring` is not sectioned when
the plane runs along its axis: it is drawn whole, with no hatch, and it hides
the cut faces behind it. When the plane cuts it across, it is hatched like any
other part. The part field `sectioned` changes this (see
[scene-schema.md](scene-schema.md)).

The ports are the `face` names a numeral port can point at. Without a `point`,
the engine uses the port's anchor on the side that faces the camera.

| Kind | Fields | Ports | Anchor of each port |
|---|---|---|---|
| `fastener` | `diameter`, `length`, `head` (`hex` default, or `round`) | `head`, `shank`, `tip` | head: side of the head (head goes up from z = 0); shank: middle of the shank (shank goes down from z = 0); tip: end of the shank |
| `spring` | `coilDiameter`, `wireDiameter`, `pitch` (more than `wireDiameter`), `length` | `top`, `bottom`, `coil` | outer edge of the top coil, the bottom coil, the middle coil |
| `gear` | `teeth` (6 to 200), `module`, `width`, `bore` (optional) | `teeth`, `face`, `bore` | teeth: the tooth nearest the camera on the pitch circle; face: top face between bore and root; bore: the bore wall (only when `bore` is set) |
| `bearing` | `innerDiameter`, `outerDiameter` (more than inner), `width` | `outer-race`, `inner-race`, `face` | outer cylinder at mid-width; inner ring on the top face; outer ring on the top face |
| `shaft` | `steps: [{ diameter, length }, ...]`, base step first, more steps along +Z | `end-1`, `end-2`, `step-1` ... `step-N`, `axis` | end-1: centre of the base end; end-2: centre of the far end; step-i: the side of step i at its middle; axis: see below |
| `pipe` | `outerDiameter`, `wall` (less than half the diameter), `length` | `outer`, `bore`, `end-1`, `end-2` | outer: side at mid-length; bore: inner wall at the far end; end-1 / end-2: the wall ring at each end |
| `motor` | `diameter`, `length`, `shaftDiameter`, `shaftLength` | `body`, `face`, `shaft` | body: side of the can; face: the output face; shaft: the output shaft (along +Z) |
| `cam` | `base` (base circle radius), `lobes: [{ angle, lift, width }, ...]` (angle and width in degrees, angle from +X towards +Y), `height` | `top`, `bottom`, `axis`, `lobe-1` ... `lobe-N`, `land-1` ... `land-N` | top: centre of the top face; axis: see below; bottom: centre of the bottom face; lobe-i: the point of maximum lift of lobe i, on the side; land-i: the middle of the base arc from lobe i to lobe i + 1, on the side |

## The `axis` port

`shaft`, `cylinder`, `revolve`, `extrudedPolygon` and `cam` have an `axis` port: the
Z axis of the part frame. A camera that looks along the axis sees it as the
centre of the top face. Any other camera sees the midpoint of the axis. A
numeral on `axis` gets a centre mark, and its lead line ends on an arm of the
mark. Use it for the axis of a cam, a shaft or a wheel.

```json
{ "numeral": "154", "part": "cam", "face": "axis" }
```

## Example: a three-part assembly

```json
{
	"figure": "FIG-3",
	"camera": "isometric",
	"parts": [
		{ "id": "shaft", "name": "shaft", "shape": { "kind": "shaft", "steps": [{ "diameter": 12, "length": 20 }, { "diameter": 16, "length": 30 }, { "diameter": 12, "length": 25 }] } },
		{ "id": "bearing", "name": "bearing", "shape": { "kind": "bearing", "innerDiameter": 12, "outerDiameter": 32, "width": 10 }, "placement": { "translate": [0, 0, 5] } },
		{ "id": "gear", "name": "gear", "shape": { "kind": "gear", "teeth": 24, "module": 2, "width": 10, "bore": 12 }, "placement": { "translate": [0, 0, 60] } }
	],
	"numerals": [
		{ "numeral": "40", "part": "shaft", "face": "step-2" },
		{ "numeral": "42", "part": "bearing", "face": "outer-race" },
		{ "numeral": "44", "part": "gear", "face": "teeth" }
	]
}
```

## Example: a cam profile

A plate cam with three lobes, seen along its axis. Each lobe is a smooth bump
of `lift` above the base circle, `width` degrees wide. The outline is one smooth
curve.

```json
{
	"figure": "FIG-4",
	"camera": "top",
	"parts": [
		{ "id": "cam", "name": "cam", "shape": { "kind": "cam", "base": 6, "lobes": [{ "angle": 0, "lift": 4, "width": 100 }, { "angle": 120, "lift": 4, "width": 100 }, { "angle": 240, "lift": 4, "width": 100 }], "height": 6 } }
	],
	"numerals": [
		{ "numeral": "154", "part": "cam", "face": "axis" },
		{ "numeral": "208", "part": "cam", "face": "lobe-2" },
		{ "numeral": "210", "part": "cam", "face": "land-1" }
	]
}
```

A part the library does not have, and that the primitives cannot build, is out
of scope ([scope-and-refusals.md](scope-and-refusals.md)).
