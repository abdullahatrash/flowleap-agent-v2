#!/usr/bin/env bash
# Build the Remote Access Viewer (PRD 0018 B4, docs/remote-access/VIEWER.md).
#
#   scripts/remote-access/build-viewer.sh [--version <v>] [--out <dir>] [--tarball <dir>] [--no-minify] [--sourcemaps]
#
# The Viewer is the fork's web Agents Window with the remote agent host provider,
# served as static files (no server). Output, in <out> (default: out-viewer):
#
#   <out>/<version>/out/            the esbuild `viewer` bundle: the workbench
#                                   (vs/sessions/sessions.viewer.main.js + .css), its boot
#                                   page (…/remoteAccessViewerBoot.js), workers and media
#   <out>/<version>/node_modules/   remote/web/node_modules (textmate, xterm, …), loaded at
#                                   run time from <file root>/../node_modules
#   <out>/index.html, loader.js     the site root: the same for every build
#   <out>/config.example.json       copy to config.json and fill in (never in a build)
#   <out>/versions.json             the builds found under <out>, newest first (local use;
#                                   install-viewer.sh writes the box's own)
#
# With --tarball <dir>: <dir>/flowleap-viewer-<version>.tar.gz holding <version>/ and site/
# (index.html, loader.js, config.example.json), the release asset install-viewer.sh takes.
#
# <version> is the FlowLeap version the Host sends as `appVersion` (contract section 3):
# --version, else FLOWLEAP_VERSION (a leading v is dropped), else product.json
# flowleapVersion, else package.json version (what an unstamped dev Host sends).
#
# Runs on macOS or Linux with Node 24.15.0 (.nvmrc) after `npm ci`. No native modules are
# built: the output is the same on every platform.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="$root/out-viewer"
tarball_dir=""
version="${FLOWLEAP_VERSION:-}"
minify=1
sourcemaps=0

die() { printf 'build-viewer: %s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--version) version="${2:?--version needs a value}"; shift 2 ;;
		--out) out_dir="${2:?--out needs a value}"; shift 2 ;;
		--tarball) tarball_dir="${2:?--tarball needs a value}"; shift 2 ;;
		--no-minify) minify=0; shift ;;
		--sourcemaps) sourcemaps=1; shift ;;
		-h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) die "unknown argument: $1" ;;
	esac
done

command -v node >/dev/null || die "node is not on PATH"
[ "$(node --version)" = "v$(cat "$root/.nvmrc")" ] || die "Node $(cat "$root/.nvmrc") is required (.nvmrc), found $(node --version)"
[ -d "$root/node_modules" ] && [ -d "$root/build/node_modules" ] || die "run npm ci first"
[ -d "$root/remote/web/node_modules" ] || die "remote/web/node_modules is missing; run npm ci first"

if [ -z "$version" ]; then
	version="$(node -p 'const p = require(process.argv[1] + "/product.json"); p.flowleapVersion || require(process.argv[1] + "/package.json").version' "$root")"
fi
version="${version#v}"
[[ "$version" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$ ]] || die "invalid version: $version"
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"
build_dir="$out_dir/$version"

# The esbuild bundle resolves codicon.ttf next to codicon.css. The gulp compile copies it
# there; this build does not run gulp. FlowLeap ships its own glyphs (build/flowleap).
codicon_src="$root/build/flowleap/codicon.ttf"
[ -f "$codicon_src" ] || codicon_src="$root/node_modules/@vscode/codicons/dist/codicon.ttf"
cp "$codicon_src" "$root/src/vs/base/browser/ui/codicons/codicon/codicon.ttf"

log "Bundling the Viewer $version (esbuild target viewer)"
bundle_rel="out-viewer-bundle"
bundle_args=(bundle --target viewer --out "$bundle_rel")
[ "$minify" = 1 ] && bundle_args+=(--minify)
(cd "$root" && node build/next/index.ts "${bundle_args[@]}")
bundle="$root/$bundle_rel"
[ -f "$bundle/vs/sessions/sessions.viewer.main.js" ] || die "the bundle has no vs/sessions/sessions.viewer.main.js"
[ -f "$bundle/vs/sessions/sessions.viewer.main.css" ] || die "the bundle has no vs/sessions/sessions.viewer.main.css"

log "Staging $build_dir"
rm -rf "$build_dir"
mkdir -p "$build_dir"
mv "$bundle" "$build_dir/out"
if [ "$sourcemaps" = 0 ]; then
	find "$build_dir/out" -name '*.map' -delete
fi
node "$root/scripts/remote-access/stage-viewer.ts" "$root" "$out_dir" "$version"

if [ -n "$tarball_dir" ]; then
	mkdir -p "$tarball_dir"
	tarball_dir="$(cd "$tarball_dir" && pwd)"
	tarball="$tarball_dir/flowleap-viewer-$version.tar.gz"
	stage="$(mktemp -d)"
	trap 'rm -rf "$stage"' EXIT
	cp -R "$build_dir" "$stage/$version"
	mkdir -p "$stage/site"
	cp "$out_dir/index.html" "$out_dir/loader.js" "$out_dir/config.example.json" "$stage/site/"
	log "Packing $tarball"
	# macOS tar would add extended attributes that GNU tar on the box warns about.
	tar_args=()
	if tar --version 2>/dev/null | grep -q bsdtar; then
		tar_args+=(--no-xattrs)
	fi
	COPYFILE_DISABLE=1 tar "${tar_args[@]}" -C "$stage" -czf "$tarball" "$version" site
	if command -v sha256sum >/dev/null; then
		(cd "$tarball_dir" && sha256sum "$(basename "$tarball")" | tee "$(basename "$tarball").sha256")
	else
		(cd "$tarball_dir" && shasum -a 256 "$(basename "$tarball")" | tee "$(basename "$tarball").sha256")
	fi
fi

log "Done: $build_dir"
