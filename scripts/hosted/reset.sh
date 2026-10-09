#!/usr/bin/env bash
# Hand a standing Hosted Workspace to the next evaluator (PRD 0019, #546).
#
#   sudo scripts/hosted/reset.sh <name> [--yes]
#
# Stops the server, wipes the previous evaluator's user data (settings, browser state,
# secrets, workspace storage, global storage) and the workspace folders, makes the empty
# workspace again, and starts the server. The agent host's config (agent-host-*.json,
# agent-host.db) and the SDK cache folders stay. Idempotent: run it twice, get the same state.
# The server package, /etc/flowleap, the nginx vhost and the Anthropic key stay.
set -euo pipefail

args=()
assume_yes=0
for arg in "$@"; do
	case "$arg" in
		--yes|-y) assume_yes=1 ;;
		*) args+=("$arg") ;;
	esac
done
name="${args[0]:?usage: reset.sh <name> [--yes]}"

etc=/etc/flowleap
user=flowleap
home=/home/$user
data=$home/.flowleap-server/data
die() { printf 'reset: %s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

[ "$(id -u)" = 0 ] || die "run as root (sudo)"
[ -f "$etc/hosted.env" ] || die "no $etc/hosted.env; run install.sh first"
# shellcheck source=/dev/null
. "$etc/hosted.env"
[ "$FLOWLEAP_HOSTED_NAME" = "$name" ] || die "this VM hosts '$FLOWLEAP_HOSTED_NAME', not '$name'"
init="$FLOWLEAP_INIT"
host="$FLOWLEAP_HOSTED_HOST"

if [ "$assume_yes" = 0 ]; then
	echo "This DELETES the evaluator data of https://$host:"
	echo "  $data/User (settings, browser state, secrets, chat history, extension storage)"
	echo "  $home/workspace and \"$home/FlowLeap Projects\""
	read -r -p "Type the name '$name' to continue: " answer
	[ "$answer" = "$name" ] || die "cancelled"
fi

log "Stop the server"
if [ "$init" = systemd ]; then
	systemctl stop flowleap-server.service
else
	pkill -u "$user" 2>/dev/null || true
	rm -f /run/flowleap/flowleap-server.pid
	sleep 2
fi

log "Wipe the user data"
rm -f "$data/User/settings.json" "$data"/User/browserState*.json "$data/User/secrets.json"
rm -rf "$data/User/workspaceStorage"
if [ -d "$data/User/globalStorage" ]; then
	# Keep the agent host's config and the SDK cache folders; drop the rest.
	find "$data/User/globalStorage" -mindepth 1 -maxdepth 1 \
		! -name 'agent-host-*.json' ! -name 'agent-host.db' ! -name '*sdk*' \
		-exec rm -rf {} +
fi
rm -rf "$home/workspace" "$home/FlowLeap Projects"
install -d -o "$user" -g "$user" -m 0750 "$home/workspace"

log "Start the server"
if [ "$init" = systemd ]; then
	systemctl start flowleap-server.service
else
	install -d -m 0755 /run/flowleap /var/log/flowleap
	# shellcheck disable=SC2046 # server.env holds KEY=value lines without spaces
	(cd "$home" && exec env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin $(cat "$etc/server.env") \
		setpriv --reuid="$user" --regid="$user" --init-groups -- /opt/flowleap-server/bin/flowleap-server --host 127.0.0.1 \
		--port "$FLOWLEAP_SERVER_PORT" --without-connection-token --accept-server-license-terms \
		--disable-workspace-trust --hosted-user-data "$home/workspace") >/var/log/flowleap/server.log 2>&1 &
	echo $! > /run/flowleap/flowleap-server.pid
fi
for _ in $(seq 1 60); do
	curl -fsS -o /dev/null "http://127.0.0.1:$FLOWLEAP_SERVER_PORT/" 2>/dev/null && break
	sleep 1
done

cat <<EOF

Reset https://$host: the workspace is empty and the server runs.
Two steps are still yours:
  1. ROTATE the allowlist entry. A password change does NOT revoke the 30-day fl_hosted
     and sign-in tokens of the previous evaluator. On the backend (ssh flowleap), in
     /opt/flowleap-backend/.env remove the old Clerk user id ($FLOWLEAP_HOSTED_OWNER at
     install time) from HOSTED_ALLOWLIST, add the new one, then: docker compose up -d
     (never restart). Give each evaluator their own account.
  2. ROTATE any BYOK key that was entered on this instance (EPO, USPTO, OpenRouter...).
     The Anthropic key of the workspace did not change; rotate it too if it was exposed.
EOF
