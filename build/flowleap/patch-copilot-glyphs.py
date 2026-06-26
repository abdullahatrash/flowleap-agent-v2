#!/usr/bin/env fontforge -script
# Replaces the GitHub Copilot glyphs in an icon font with the FlowLeap logo,
# preserving the original badge overlays (warning, error, slash, zZ, ...).
#
# Requires FontForge (brew install fontforge). Run from the repo root:
#
#   # core codicon font (after an @vscode/codicons package bump):
#   fontforge -script build/flowleap/patch-copilot-glyphs.py \
#       node_modules/@vscode/codicons/dist/codicon.ttf build/flowleap/codicon.ttf
#
#   # patent-ai-agent extension icon font (run against a stock copilot.woff):
#   fontforge -script build/flowleap/patch-copilot-glyphs.py --woff \
#       <stock-copilot.woff> <out-copilot.woff>
#
# The copilot glyph code points are defined in src/vs/base/common/codiconsLibrary.ts;
# update CORE below if upstream adds or renumbers copilot-* codicons.

import fontforge
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, 'flowleap-logo.svg')

EM = 300
MARGIN = 18  # halo width around badges, in font units

# badge selection rules: ('region', box) keeps original contours fully inside
# the box; ('slash',) synthesizes a diagonal strike-through
BR = ('region', (115, -10, 310, 176))   # bottom-right badge
TR = ('region', (120, 140, 310, 310))   # top-right badge (snooze)
SLASH = ('slash',)

# core codicon.ttf glyphs (codiconsLibrary.ts)
CORE = [
	(0xec1e, None, 'copilot'),
	(0xec3a, None, 'copilot-large'),
	(0xec8a, None, 'copilot-compact'),
	(0xec38, BR, 'copilot-warning'),
	(0xec3b, BR, 'copilot-warning-large'),
	(0xec3d, BR, 'copilot-blocked'),
	(0xec3e, BR, 'copilot-not-connected'),
	(0xec4c, BR, 'copilot-in-progress'),
	(0xec4d, BR, 'copilot-error'),
	(0xec4e, BR, 'copilot-success'),
	(0xec52, TR, 'copilot-snooze'),
	(0xec42, SLASH, 'copilot-unavailable'),
]

# vscode-copilot-chat assets/copilot.woff glyphs (contributes.icons)
EXT = [
	(0x41, None, 'copilot-logo'),
	(0x42, BR, 'copilot-warning'),
	(0x43, SLASH, 'copilot-notconnected'),
]

scratch = fontforge.font()
scratch.em = EM


def contour_inside(bb, box):
	return bb[0] >= box[0] and bb[1] >= box[1] and bb[2] <= box[2] and bb[3] <= box[3]


def as_order(layer, quadratic):
	l = layer.dup()
	l.is_quadratic = quadratic
	return l


def bar_contour(p1, p2, halfw):
	"""thick line segment as a 4-point polygon, ends extended by halfw"""
	dx, dy = p2[0] - p1[0], p2[1] - p1[1]
	length = (dx * dx + dy * dy) ** 0.5
	ux, uy = dx / length, dy / length
	nx, ny = -uy * halfw, ux * halfw
	a = (p1[0] - ux * halfw, p1[1] - uy * halfw)
	b = (p2[0] + ux * halfw, p2[1] + uy * halfw)
	c = fontforge.contour(True)
	c.moveTo(a[0] + nx, a[1] + ny)
	c.lineTo(b[0] + nx, b[1] + ny)
	c.lineTo(b[0] - nx, b[1] - ny)
	c.lineTo(a[0] - nx, a[1] - ny)
	c.closed = True
	return c


# diagonal strike-through, top-left to bottom-right (font y-axis points up)
SLASH_P1 = (32, 268)
SLASH_P2 = (268, 32)


def pick_badge(glyph, rule):
	badge = fontforge.layer()
	badge.is_quadratic = glyph.foreground.is_quadratic
	if rule[0] == 'slash':
		# upstream slash contours are fused with the old logo; synthesize instead
		badge += bar_contour(SLASH_P1, SLASH_P2, 11)
		return badge
	for c in glyph.foreground:
		bb = c.boundingBox()
		if contour_inside(bb, rule[1]):
			badge += c
	return badge


def outer_contours(layer):
	"""contours not contained in another contour's bbox (drop interior holes)"""
	result = fontforge.layer()
	result.is_quadratic = layer.is_quadratic
	boxes = [c.boundingBox() for c in layer]
	for i, c in enumerate(layer):
		bb = boxes[i]
		contained = False
		for j, ob in enumerate(boxes):
			if i != j and bb[0] >= ob[0] and bb[1] >= ob[1] and bb[2] <= ob[2] and bb[3] <= ob[3]:
				contained = True
				break
		if not contained:
			result += c
	return result


def force_clockwise(layer):
	for c in layer:
		if not c.isClockwise():
			c.reverseDirection()
	return layer


def expand(layer, margin):
	"""expanded outer silhouette of layer: fill + centered stroke, unioned"""
	t = scratch.createChar(0xF8FF, 'knock')
	t.clear()
	cubic = as_order(layer, False)
	t.foreground = cubic
	t.stroke('circular', margin * 2)
	merged = t.foreground
	for c in cubic:
		merged += c
	force_clockwise(merged)
	t.foreground = merged
	t.removeOverlap()
	return t.foreground


def drop_slivers(glyph, min_dim=6):
	keep = fontforge.layer()
	keep.is_quadratic = glyph.foreground.is_quadratic
	for c in glyph.foreground:
		bb = c.boundingBox()
		if min(bb[2] - bb[0], bb[3] - bb[1]) >= min_dim:
			keep += c
	glyph.foreground = keep


def import_logo(glyph):
	glyph.clear()
	glyph.importOutlines(SVG)
	glyph.removeOverlap()
	glyph.correctDirection()
	glyph.width = EM


def patch_glyph(font, cp, rule, label):
	g = font[cp]
	badge = pick_badge(g, rule) if rule else None
	if rule and len(badge) == 0:
		raise RuntimeError('no badge contours matched for %s U+%04X' % (label, cp))
	import_logo(g)
	if badge is not None:
		knockout = as_order(expand(outer_contours(badge), MARGIN), g.foreground.is_quadratic)
		# subtraction by winding: append knockout reversed, then removeOverlap
		fg = g.foreground
		for c in force_clockwise(knockout):
			c.reverseDirection()
			fg += c
		g.foreground = fg
		g.removeOverlap()
		drop_slivers(g)
		fg = g.foreground
		for c in badge:
			fg += c
		g.foreground = fg
		g.width = EM
	print('patched %s U+%04X contours=%d' % (label, cp, len(g.foreground)))


def main():
	args = sys.argv[1:]
	glyphs = CORE
	if args and args[0] == '--woff':
		glyphs = EXT
		args = args[1:]
	if len(args) != 2:
		sys.exit('usage: patch-copilot-glyphs.py [--woff] <in-font> <out-font>')
	src, dest = args
	font = fontforge.open(src)
	if font.em != EM:
		sys.exit('unexpected em size %d (expected %d); glyph geometry needs review' % (font.em, EM))
	for cp, rule, label in glyphs:
		patch_glyph(font, cp, rule, label)
	font.generate(dest)
	print('wrote %s' % dest)


main()
