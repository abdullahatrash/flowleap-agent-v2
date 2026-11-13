#!/bin/sh
# Launcher of the FlowLeap drawings CLI for the patent-drawings skill (PRD 0023, slice D6).
#
# Usage: sh drawings.sh render|build|propose ...   (the arguments go to drawings-cli.js unchanged)
#
# The CLI is extensions/copilot/dist/drawings-cli.js of the running app, beside the geometry
# kernel it loads. The Agents Window copies this skill folder out of the app, so this script
# finds the app from the process that runs the agent, not from its own folder:
#
#   1. $FLOWLEAP_DRAWINGS_CLI (path to drawings-cli.js), run with $FLOWLEAP_DRAWINGS_NODE or node.
#   2. The parent processes: the first executable that belongs to an app with the CLI. The agent
#      runs on the app's own executable, so that executable also runs the CLI as Node
#      (ELECTRON_RUN_AS_NODE=1). Packaged macOS: <App>.app/Contents/Resources/app/...; dev build:
#      <repo>/.build/electron/... gives <repo>/extensions/copilot/dist; Linux and Windows:
#      <install dir>/resources/app/...
#   3. The default install folders (macOS /Applications, Linux /usr/share/flowleap, Windows
#      %LOCALAPPDATA%/Programs/Flow Leap).
#
# On failure it prints one JSON object with the reason and exits 1, like a CLI refusal.

CLI_SUFFIX="extensions/copilot/dist/drawings-cli.js"

fail() {
	printf '{ "ok": false, "command": "launcher", "reason": "%s" }\n' "$1"
	exit 1
}

run_with() {
	# $1 = executable, $2 = drawings-cli.js; the rest are the CLI arguments.
	exe="$1"
	cli="$2"
	shift 2
	ELECTRON_RUN_AS_NODE=1 exec "$exe" "$cli" "$@"
}

# The CLI of the app an executable belongs to, or nothing.
cli_for_executable() {
	exe="$1"
	case "$exe" in
		/*) ;;
		*) return ;;
	esac
	case "$exe" in
		*/.build/electron/*)
			candidate="${exe%%/.build/electron/*}/$CLI_SUFFIX" ;;
		*.app/Contents/*)
			candidate="${exe%%.app/Contents/*}.app/Contents/Resources/app/$CLI_SUFFIX" ;;
		*)
			candidate="$(dirname -- "$exe")/resources/app/$CLI_SUFFIX" ;;
	esac
	if [ -f "$candidate" ]; then
		printf '%s' "$candidate"
	fi
}

# The executable of a process: /proc on Linux, ps elsewhere (macOS prints the full path).
executable_of() {
	if [ -r "/proc/$1/exe" ]; then
		readlink "/proc/$1/exe" 2>/dev/null
	else
		ps -o comm= -p "$1" 2>/dev/null
	fi
}

# 1. Explicit override.
if [ -n "$FLOWLEAP_DRAWINGS_CLI" ]; then
	[ -f "$FLOWLEAP_DRAWINGS_CLI" ] || fail "FLOWLEAP_DRAWINGS_CLI points at a missing file: $FLOWLEAP_DRAWINGS_CLI"
	if [ -n "$FLOWLEAP_DRAWINGS_NODE" ]; then
		run_with "$FLOWLEAP_DRAWINGS_NODE" "$FLOWLEAP_DRAWINGS_CLI" "$@"
	fi
	command -v node >/dev/null 2>&1 || fail "FLOWLEAP_DRAWINGS_CLI is set but node is not on PATH; set FLOWLEAP_DRAWINGS_NODE to the app executable."
	exec node "$FLOWLEAP_DRAWINGS_CLI" "$@"
fi

# 2. The parent processes.
pid=$$
depth=0
while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null && [ "$depth" -lt 12 ]; do
	exe="$(executable_of "$pid")"
	if [ -n "$exe" ]; then
		cli="$(cli_for_executable "$exe")"
		if [ -n "$cli" ]; then
			run_with "$exe" "$cli" "$@"
		fi
	fi
	pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
	depth=$((depth + 1))
done

# 3. Default install folders.
for app in /Applications/Flow\ Leap*.app "$HOME"/Applications/Flow\ Leap*.app; do
	if [ -f "$app/Contents/Resources/app/$CLI_SUFFIX" ]; then
		for exe in "$app"/Contents/MacOS/*; do
			run_with "$exe" "$app/Contents/Resources/app/$CLI_SUFFIX" "$@"
		done
	fi
done
for dir in /usr/share/flowleap /opt/flowleap "${LOCALAPPDATA:-/nonexistent}/Programs/Flow Leap"; do
	if [ -f "$dir/resources/app/$CLI_SUFFIX" ]; then
		for exe in "$dir/flowleap" "$dir/Flow Leap.exe"; do
			if [ -f "$exe" ]; then
				run_with "$exe" "$dir/resources/app/$CLI_SUFFIX" "$@"
			fi
		done
	fi
done

fail "drawings-cli.js was not found. Set FLOWLEAP_DRAWINGS_CLI to <app>/resources/app/$CLI_SUFFIX (macOS: <App>.app/Contents/Resources/app/$CLI_SUFFIX)."
