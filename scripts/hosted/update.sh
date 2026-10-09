#!/usr/bin/env bash
# Update the server package of one Hosted Workspace (PRD 0019, #546).
#
#   sudo scripts/hosted/update.sh <tarball>
#
# <tarball> is flowleap-server-web-<version>-linux-x64.tar.gz from build-package.sh. A
# <tarball>.sha256 file beside it is checked when it exists (only the hash is compared; the
# file names the path inside the build container).
#
# Steps: check the hash, unpack to /opt/flowleap-server.new, sanity-check it, stop the
# server, swap (the old package stays as /opt/flowleap-server.prev, one generation), start,
# wait for "Extension host agent started" (60 s), run verify.sh. If anything fails after the
# stop, the old package goes back, the server starts again, and the script exits 1.
#
# User state is not touched: the workspace, ~flowleap/.flowleap-server/data, /etc/flowleap
# (key files, env files) and the nginx vhost stay as they are.
set -euo pipefail

tarball="${1:?usage: update.sh <tarball>}"
prefix=/opt/flowleap-server
etc=/etc/flowleap
user=flowleap
home=/home/$user
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wait_seconds="${FLOWLEAP_UPDATE_WAIT:-60}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'update: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (sudo)"
[ -f "$tarball" ] || die "no tarball at $tarball"
[ -f "$etc/hosted.env" ] || die "no $etc/hosted.env; run install.sh first"
# shellcheck source=/dev/null
. "$etc/hosted.env"
init="$FLOWLEAP_INIT"
name="$FLOWLEAP_HOSTED_NAME"
[ -d "$prefix" ] || die "no $prefix; run install.sh first"

stop_server() {
	if [ "$init" = systemd ]; then
		systemctl stop flowleap-server.service
	else
		pkill -u "$user" 2>/dev/null || true
		rm -f /run/flowleap/flowleap-server.pid
		sleep 2
	fi
}

start_server() {
	if [ "$init" = systemd ]; then
		systemctl start flowleap-server.service
	else
		# Same user, env file and command as the unit (see install.sh).
		install -d -m 0755 /run/flowleap /var/log/flowleap
		# shellcheck disable=SC2046 # server.env holds KEY=value lines without spaces
		(cd "$home" && exec env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin $(cat "$etc/server.env") \
			setpriv --reuid="$user" --regid="$user" --init-groups -- "$prefix/bin/flowleap-server" --host 127.0.0.1 \
			--port "$FLOWLEAP_SERVER_PORT" --without-connection-token --accept-server-license-terms \
			--disable-workspace-trust --hosted-user-data "$home/workspace") >/var/log/flowleap/server.log 2>&1 &
		echo $! > /run/flowleap/flowleap-server.pid
	fi
}

link_cli() {
	if [ -x "$prefix/flowleap-cli/flowleap" ]; then
		ln -sf "$prefix/flowleap-cli/flowleap" /usr/local/bin/flowleap
	fi
}

# 0 when the server logged that the extension host agent started, after the last start.
wait_started() {
	local since="$1"
	for _ in $(seq 1 "$wait_seconds"); do
		if [ "$init" = systemd ]; then
			journalctl -u flowleap-server.service --since "$since" --no-pager 2>/dev/null | grep -q 'Extension host agent started' && return 0
		else
			grep -q 'Extension host agent started' /var/log/flowleap/server.log 2>/dev/null && return 0
		fi
		sleep 1
	done
	return 1
}

log "Check the hash"
actual="$(sha256sum "$tarball" | cut -d' ' -f1)"
if [ -f "$tarball.sha256" ]; then
	expected="$(cut -d' ' -f1 "$tarball.sha256" | head -n1)"
	[ "$actual" = "$expected" ] || die "sha256 mismatch: $tarball is $actual, $tarball.sha256 says $expected"
	echo "sha256 $actual matches $tarball.sha256"
else
	echo "update: no $tarball.sha256; hash is $actual (not checked)" >&2
fi

log "Unpack to $prefix.new"
rm -rf "$prefix.new"
mkdir -p "$prefix.new"
tar -xzf "$tarball" -C "$prefix.new" --strip-components=1
[ -x "$prefix.new/bin/flowleap-server" ] || { rm -rf "$prefix.new"; die "the tarball has no bin/flowleap-server"; }
[ -d "$prefix.new/claude-sdk" ] || { rm -rf "$prefix.new"; die "the tarball has no vendored Claude SDK (claude-sdk/)"; }
# A package built without the web patch would open in Restricted Mode (#521).
if [ "$(grep -c '"when": "!isWeb"' "$prefix.new/extensions/copilot/package.json" || true)" != 0 ]; then
	rm -rf "$prefix.new"
	die 'extensions/copilot/package.json still has "when": "!isWeb" entries; rebuild the package'
fi
chown -R root:root "$prefix.new"

log "Swap (the old package stays as $prefix.prev)"
stop_server
rm -rf "$prefix.prev"
mv "$prefix" "$prefix.prev"
mv "$prefix.new" "$prefix"
link_cli
since="$(date '+%Y-%m-%d %H:%M:%S')"
start_server

ok=1
log "Wait for the server (up to ${wait_seconds} s)"
if wait_started "$since"; then
	echo "server logged: Extension host agent started"
	log "verify.sh"
	"$script_dir/verify.sh" "$name" || ok=0
else
	echo "update: no 'Extension host agent started' within ${wait_seconds} s" >&2
	ok=0
fi

if [ "$ok" = 0 ]; then
	log "FAILED: putting $prefix.prev back"
	stop_server
	rm -rf "$prefix"
	mv "$prefix.prev" "$prefix"
	link_cli
	start_server
	die "the update failed; the previous package is running again"
fi

quality="$(sed -n 's/^[[:space:]]*"quality":[[:space:]]*"\([^"]*\)".*/\1/p' "$prefix/product.json" | head -n1)"
commit="$(sed -n 's/^[[:space:]]*"commit":[[:space:]]*"\([^"]*\)".*/\1/p' "$prefix/product.json" | head -n1)"
log "Updated https://$FLOWLEAP_HOSTED_HOST"
echo "Installed product path: ${quality:-oss}-$commit"
echo "Previous package kept at $prefix.prev. User state was not touched."
