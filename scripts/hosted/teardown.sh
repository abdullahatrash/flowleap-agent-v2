#!/usr/bin/env bash
# Remove one Hosted Workspace from its VM (ADR 0011, #507).
#
#   sudo scripts/hosted/teardown.sh <name>
#
# Stops and removes the units, the vhost and its certificate, the server package, the
# workspace user with the workspace, and the key file. The key itself stays valid at
# Anthropic until you revoke it: the script ends with that reminder.
set -euo pipefail

name="${1:?usage: teardown.sh <name>}"
etc=/etc/flowleap
[ "$(id -u)" = 0 ] || { echo "teardown: run as root (sudo)" >&2; exit 1; }

host="$name.${FLOWLEAP_HOSTED_DOMAIN:-app.flowleap.co}"
init=systemd
owner="(see the backend HOSTED_ALLOWLIST)"
if [ -f "$etc/hosted.env" ]; then
	# shellcheck source=/dev/null
	. "$etc/hosted.env"
	[ "$FLOWLEAP_HOSTED_NAME" = "$name" ] || { echo "teardown: this VM hosts '$FLOWLEAP_HOSTED_NAME', not '$name'" >&2; exit 1; }
	host="$FLOWLEAP_HOSTED_HOST"
	init="$FLOWLEAP_INIT"
	owner="$FLOWLEAP_HOSTED_OWNER"
fi

echo "==> Stopping services ($init)"
if [ "$init" = systemd ]; then
	for unit in flowleap-server flowleap-anthropic-proxy; do
		systemctl disable --now "$unit.service" 2>/dev/null || true
		rm -f "/etc/systemd/system/$unit.service"
	done
	systemctl daemon-reload
else
	for pidfile in /run/flowleap/*.pid; do
		[ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null || true
		rm -f "$pidfile"
	done
fi
pkill -u flowleap 2>/dev/null || true

echo "==> Removing the vhost and certificate for $host"
rm -f "/etc/nginx/sites-enabled/$host" "/etc/nginx/sites-available/$host" /etc/nginx/conf.d/flowleap-hosted.conf
rm -rf /var/cache/nginx/hosted_auth
if command -v certbot >/dev/null && [ -d "/etc/letsencrypt/live/$host" ]; then
	certbot delete --cert-name "$host" --non-interactive
fi
if nginx -t -q 2>/dev/null; then
	if [ "$init" = systemd ]; then systemctl reload nginx || true; else nginx -s reload 2>/dev/null || true; fi
fi

echo "==> Removing the server, the workspace and the key file"
rm -rf /opt/flowleap-server /opt/flowleap-server.new /usr/local/lib/flowleap
rm -f /usr/local/bin/flowleap
if id -u flowleap >/dev/null 2>&1; then
	userdel --remove flowleap 2>/dev/null || true
fi
rm -rf /home/flowleap
id -u flowleap-proxy >/dev/null 2>&1 && userdel flowleap-proxy 2>/dev/null || true
if [ -f "$etc/anthropic-proxy.env" ]; then
	shred -u "$etc/anthropic-proxy.env" 2>/dev/null || rm -f "$etc/anthropic-proxy.env"
fi
rm -rf "$etc" /run/flowleap /var/log/flowleap

cat <<EOF

Removed https://$host from this VM. Two steps are still yours:
  1. REVOKE the Anthropic API key of this workspace in the Anthropic Console
     (Settings -> API keys). Removing the file does not make a copied key stop working.
  2. REMOVE $owner from HOSTED_ALLOWLIST in /opt/flowleap-backend/.env on the backend,
     then: docker compose up -d   (never restart). Also delete the DNS record for $host.
EOF
