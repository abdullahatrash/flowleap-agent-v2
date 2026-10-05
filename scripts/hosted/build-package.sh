#!/usr/bin/env bash
# Build the Hosted Workspace server package (ADR 0011, #507).
#
#   scripts/hosted/build-package.sh <git-ref> [out-dir]
#
# Builds the reh-web linux-x64 server from a clean checkout of <git-ref> and writes
#   <out-dir>/flowleap-server-web-<version>-linux-x64.tar.gz
# The tarball holds the server, the pinned Claude agent SDK (claude-sdk/), the FlowLeap
# CLI (flowleap-cli/flowleap) and these hosted scripts (hosted/).
#
# Run it ON LINUX x64 with Node 24.15.0 (.nvmrc). A build on macOS ships Mach-O native
# modules that fail on the VM (H1 spike finding 1). Two supported ways:
#
#   docker run --rm --platform linux/amd64 -v "$PWD/out:/out" node:24.15.0-bookworm bash -c \
#     'curl -fsSL https://raw.githubusercontent.com/abdullahatrash/flowleap-agent-v2/<ref>/scripts/hosted/build-package.sh | bash -s -- <ref> /out'
#   or on the VM itself, after installing Node 24.15.0 (the same pipe, without docker).
# The script clones <ref> itself; the checkout it runs from is not used for the build.
#
# Docker Desktop needs about 16 GB of memory for the compile step (gulp runs with a 16 GB heap).
#
# Environment:
#   FLOWLEAP_REPO_URL        git URL to clone (default: the public GitHub repo)
#   FLOWLEAP_VERSION         version in the file name (default: <ref> without a leading v,
#                            or the short commit when <ref> is not a version tag)
#   FLOWLEAP_CLI_VERSION     FlowLeap CLI release tag (default: v0.9.1)
#   FLOWLEAP_BUILD_DIR       work directory (default: a new temporary directory)
#   FLOWLEAP_PREBUILT_SERVER an existing vscode-reh-web-linux-x64 folder: skip the clone
#                            and the gulp build, only vendor the SDK and CLI and pack.
#                            The folder must have Linux native modules.
set -euo pipefail

ref="${1:?usage: build-package.sh <git-ref> [out-dir]}"
out_dir="$(mkdir -p "${2:-$PWD}" && cd "${2:-$PWD}" && pwd)"
repo_url="${FLOWLEAP_REPO_URL:-https://github.com/abdullahatrash/flowleap-agent-v2.git}"
cli_version="${FLOWLEAP_CLI_VERSION:-v0.9.1}"
work="${FLOWLEAP_BUILD_DIR:-$(mktemp -d)}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'build-package: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "run this on Linux x64 (see the header), not $(uname -s)"
[ "$(uname -m)" = x86_64 ] || die "run this on x86_64, not $(uname -m)"
command -v node >/dev/null || die "node is not on PATH"
[ "$(node --version)" = v24.15.0 ] || die "Node 24.15.0 is required (.nvmrc), found $(node --version). Use node:24.15.0-bookworm."

src="$work/flowleap-agent-v2"
if [ -n "${FLOWLEAP_PREBUILT_SERVER:-}" ]; then
	server="$(cd "$FLOWLEAP_PREBUILT_SERVER" && pwd)"
	[ -x "$server/bin/flowleap-server" ] || die "$server has no bin/flowleap-server"
	log "Using the prebuilt server at $server (no clone, no gulp)"
	[ -d "$script_dir/../../build/agent-sdk/agents/claude" ] || die "FLOWLEAP_PREBUILT_SERVER needs this script inside a repo checkout (for build/agent-sdk)"
	mkdir -p "$src/build/agent-sdk/agents" "$src/scripts"
	cp -R "$script_dir/../../build/agent-sdk/agents/claude" "$src/build/agent-sdk/agents/claude"
	cp -R "$script_dir" "$src/scripts/hosted"
	commit="$(git -C "$script_dir" rev-parse --short HEAD 2>/dev/null || echo prebuilt)"
else
	log "Installing build prerequisites"
	if [ "$(id -u)" = 0 ]; then
		apt-get update -qq
		apt-get install -y -qq git file pkg-config build-essential python3 libkrb5-dev libxkbfile-dev libx11-dev libsecret-1-dev >/dev/null
	fi

	log "Cloning $repo_url at $ref"
	git init -q "$src"
	git -C "$src" remote add origin "$repo_url"
	git -C "$src" fetch -q --depth 1 origin "$ref"
	git -C "$src" checkout -q FETCH_HEAD
	commit="$(git -C "$src" rev-parse --short HEAD)"
	[ "$(cat "$src/.nvmrc")" = 24.15.0 ] || die ".nvmrc at $ref is $(cat "$src/.nvmrc"), this script expects 24.15.0"

	log "npm ci (root, remote/, extensions/) on Linux"
	(cd "$src" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci)

	if [ -n "${FLOWLEAP_VERSION:-}" ] || [[ "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]; then
		(cd "$src" && FLOWLEAP_VERSION="${FLOWLEAP_VERSION:-$ref}" node build/flowleap/stamp-flowleap-version.mjs)
	fi

	# The sequence from #521 (H1b). The mangling compile fails, so the -min-ci task
	# runs after the non-mangled compile and the separate extension tasks.
	log "gulp build (about 15 minutes on a fast machine)"
	gulp=(node --experimental-strip-types --max-old-space-size=16384 ./node_modules/gulp/bin/gulp.js)
	for t in compile-build-without-mangling \
		compile-extension:pdf-preview \
		compile-extension:flowleap \
		compile-extension:docx-viewer \
		compile-extensions-build \
		compile-copilot-extension-build \
		compile-extension-media-build \
		minify-vscode-reh-web \
		vscode-reh-web-linux-x64-min-ci; do
		log "gulp $t"
		(cd "$src" && "${gulp[@]}" "$t")
	done
	server="$work/vscode-reh-web-linux-x64"
	[ -x "$server/bin/flowleap-server" ] || die "the gulp build did not produce $server/bin/flowleap-server"
	[ -f "$server/out/vs/platform/agentHost/node/agentHostMain.js" ] || die "agentHostMain.js is missing from the package (#517)"
fi

if [[ "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]; then
	version="${FLOWLEAP_VERSION:-${ref#v}}"
else
	version="${FLOWLEAP_VERSION:-$commit}"
fi
name="flowleap-server-web-$version-linux-x64"
stage="$work/stage/$name"
rm -rf "$work/stage"
mkdir -p "$stage"

log "Staging the server"
cp -a "$server/." "$stage/"
if find "$stage/node_modules" -name '*.node' -print0 | xargs -0 file | grep -v 'ELF 64-bit' | grep -q '\.node:'; then
	die "the server node_modules has non-Linux native modules; build on Linux"
fi

# The reh gulp task stamps product.agentSdks only for type reh, so the reh-web package
# would download nothing. Vendor the pinned SDK instead; the server unit points
# VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT at it (agentSdkDownloader dev override).
log "Vendoring the pinned Claude agent SDK"
cp -R "$src/build/agent-sdk/agents/claude" "$stage/claude-sdk"
(cd "$stage/claude-sdk" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
[ -f "$stage/claude-sdk/node_modules/@anthropic-ai/claude-agent-sdk/package.json" ] || die "Claude agent SDK install failed"

log "Adding the FlowLeap CLI $cli_version"
mkdir -p "$stage/flowleap-cli"
cli_base="https://github.com/flowleap-ai/flowleap-cli/releases/download/$cli_version"
curl -fsSL -o "$stage/flowleap-cli/flowleap" "$cli_base/flowleap-linux-x86_64"
expected="$(curl -fsSL "$cli_base/checksums.txt" | awk '$2 ~ /(^|\/)flowleap-linux-x86_64$/ { print $1 }')"
actual="$(sha256sum "$stage/flowleap-cli/flowleap" | awk '{ print $1 }')"
[ -n "$expected" ] && [ "$expected" = "$actual" ] || die "FlowLeap CLI checksum mismatch (expected '$expected', got '$actual')"
chmod 755 "$stage/flowleap-cli/flowleap"

log "Adding the hosted scripts"
mkdir -p "$stage/hosted"
hosted_src="$src/scripts/hosted"
cp "$hosted_src/install.sh" "$hosted_src/teardown.sh" "$hosted_src/verify.sh" "$hosted_src/anthropic-proxy.ts" "$stage/hosted/"
printf '%s\n' "$version ($commit), CLI $cli_version" > "$stage/hosted/VERSION"

tarball="$out_dir/$name.tar.gz"
log "Packing $tarball"
tar -C "$work/stage" -czf "$tarball" "$name"
sha256sum "$tarball" | tee "$tarball.sha256"
