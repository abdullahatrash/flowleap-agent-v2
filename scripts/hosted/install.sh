#!/usr/bin/env bash
# Install one Hosted Workspace on a fresh Ubuntu 24.04 VM (ADR 0011, #507).
#
#   sudo scripts/hosted/install.sh <name> <tarball> <clerk-user-id>
#
# <name>           the DNS label: the workspace is served at https://<name>.app.flowleap.co
# <tarball>        flowleap-server-web-<version>-linux-x64.tar.gz from build-package.sh
# <clerk-user-id>  the invitee (user_...). Recorded on the VM; add it to the backend's
#                  HOSTED_ALLOWLIST yourself (docs/hosted/README.md).
#
# The real Anthropic key is read from FLOWLEAP_ANTHROPIC_API_KEY, or asked for (hidden).
# It goes only into /etc/flowleap/anthropic-proxy.env (root, 0600), read by the proxy unit.
# The server unit gets ANTHROPIC_BASE_URL=<proxy> and ANTHROPIC_API_KEY=hosted-dummy.
#
# Environment (defaults are production):
#   FLOWLEAP_HOSTED_DOMAIN   parent domain (default app.flowleap.co)
#   FLOWLEAP_API_ORIGIN      backend origin (default https://api.flowleap.co)
#   FLOWLEAP_AUTHORIZE_URL   auth_request target (default $FLOWLEAP_API_ORIGIN/v1/hosted/authorize)
#   PATENT_API_URL           Patent API for the extension (default https://api.flowleap.co/v1)
#   FLOWLEAP_PROXY_PORT      key proxy port on 127.0.0.1 (default 8787)
#   FLOWLEAP_SERVER_PORT     server port on 127.0.0.1 (default 8000)
#   FLOWLEAP_TLS             letsencrypt (default) | self-signed (local proof only)
#   FLOWLEAP_CERTBOT_EMAIL   Let's Encrypt account e-mail (default ops@flowleap.co)
#   FLOWLEAP_INIT            systemd (default) | direct (containers without systemd:
#                            starts the same commands with the same users and env files)
set -euo pipefail

name="${1:?usage: install.sh <name> <tarball> <clerk-user-id>}"
tarball="${2:?usage: install.sh <name> <tarball> <clerk-user-id>}"
owner="${3:?usage: install.sh <name> <tarball> <clerk-user-id>}"

domain="${FLOWLEAP_HOSTED_DOMAIN:-app.flowleap.co}"
host="$name.$domain"
api_origin="${FLOWLEAP_API_ORIGIN:-https://api.flowleap.co}"
authorize_url="${FLOWLEAP_AUTHORIZE_URL:-$api_origin/v1/hosted/authorize}"
patent_api_url="${PATENT_API_URL:-https://api.flowleap.co/v1}"
proxy_port="${FLOWLEAP_PROXY_PORT:-8787}"
server_port="${FLOWLEAP_SERVER_PORT:-8000}"
tls="${FLOWLEAP_TLS:-letsencrypt}"
init="${FLOWLEAP_INIT:-systemd}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

prefix=/opt/flowleap-server
etc=/etc/flowleap
user=flowleap
proxy_user=flowleap-proxy
home=/home/$user
workspace=$home/workspace

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (sudo)"
[[ "$name" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die "<name> must be one DNS label (a-z, 0-9, -)"
[[ "$owner" =~ ^user_[A-Za-z0-9]+$ ]] || die "<clerk-user-id> must look like user_..."
[ -f "$tarball" ] || die "no tarball at $tarball"
[ -f "$script_dir/anthropic-proxy.ts" ] || die "anthropic-proxy.ts must be next to install.sh"
case "$tls" in letsencrypt|self-signed) ;; *) die "FLOWLEAP_TLS must be letsencrypt or self-signed" ;; esac
case "$init" in systemd|direct) ;; *) die "FLOWLEAP_INIT must be systemd or direct" ;; esac

api_key="${FLOWLEAP_ANTHROPIC_API_KEY:-}"
if [ -z "$api_key" ]; then
	read -r -s -p "Anthropic API key for $host (input hidden): " api_key
	echo
fi
[ -n "$api_key" ] || die "no Anthropic API key"

log "Swap"
# 4 GB VMs run out of memory while the server, the extension host and the agent host start.
mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
if [ "${mem_kb:-0}" -lt 6000000 ] && [ -z "$(swapon --show --noheadings 2>/dev/null)" ]; then
	if [ ! -f /swapfile ]; then
		fallocate -l 4G /swapfile
		chmod 0600 /swapfile
		mkswap /swapfile >/dev/null
	fi
	swapon /swapfile || echo "install: swapon failed (a container may forbid it); continuing" >&2
	grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
	echo 'vm.swappiness=10' > /etc/sysctl.d/99-flowleap-swap.conf
	sysctl -q -p /etc/sysctl.d/99-flowleap-swap.conf || true
else
	echo "RAM >= 6 GB or swap already present: nothing to do"
fi

log "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl nginx libkrb5-3 libgssapi-krb5-2 >/dev/null
if [ "$tls" = letsencrypt ]; then
	apt-get install -y -qq certbot >/dev/null
fi

log "Users"
id -u "$user" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$user"
id -u "$proxy_user" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$proxy_user"
install -d -o "$user" -g "$user" -m 0750 "$workspace"

log "Server package -> $prefix"
rm -rf "$prefix.new"
mkdir -p "$prefix.new"
tar -xzf "$tarball" -C "$prefix.new" --strip-components=1
[ -x "$prefix.new/bin/flowleap-server" ] || die "the tarball has no bin/flowleap-server"
[ -d "$prefix.new/claude-sdk/node_modules/@anthropic-ai/claude-agent-sdk" ] || die "the tarball has no vendored Claude SDK (claude-sdk/)"
rm -rf "$prefix"
mv "$prefix.new" "$prefix"
chown -R root:root "$prefix"
if [ -x "$prefix/flowleap-cli/flowleap" ]; then
	ln -sf "$prefix/flowleap-cli/flowleap" /usr/local/bin/flowleap
fi
install -d -m 0755 /usr/local/lib/flowleap
install -m 0644 "$script_dir/anthropic-proxy.ts" /usr/local/lib/flowleap/anthropic-proxy.ts

log "Environment files in $etc"
install -d -m 0755 "$etc"
# Secret: root-only. systemd reads it as root before it drops to $proxy_user.
(umask 077 && printf 'ANTHROPIC_API_KEY=%s\nPROXY_PORT=%s\n' "$api_key" "$proxy_port" > "$etc/anthropic-proxy.env")
chown root:root "$etc/anthropic-proxy.env"
chmod 0600 "$etc/anthropic-proxy.env"
unset api_key FLOWLEAP_ANTHROPIC_API_KEY
# Not secret: everything the server process tree (and so the browser terminal) can see.
cat > "$etc/server.env" <<EOF
HOME=$home
ANTHROPIC_BASE_URL=http://127.0.0.1:$proxy_port
ANTHROPIC_API_KEY=hosted-dummy
PATENT_API_URL=$patent_api_url
VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT=$prefix/claude-sdk
FLOWLEAP_HOSTED_SECRET_KEY_FILE=$etc/hosted-secret.key
EOF
chmod 0644 "$etc/server.env"
# Server part of the key that encrypts the browser's secrets file on this VM (#547).
# Kept outside the server's data folder; made once, kept when install.sh runs again.
if [ ! -s "$etc/hosted-secret.key" ]; then
	(umask 077 && head -c 32 /dev/urandom > "$etc/hosted-secret.key")
fi
chown "$user:$user" "$etc/hosted-secret.key"
chmod 0400 "$etc/hosted-secret.key"
cat > "$etc/hosted.env" <<EOF
FLOWLEAP_HOSTED_NAME=$name
FLOWLEAP_HOSTED_HOST=$host
FLOWLEAP_HOSTED_OWNER=$owner
FLOWLEAP_PROXY_PORT=$proxy_port
FLOWLEAP_SERVER_PORT=$server_port
FLOWLEAP_TLS=$tls
FLOWLEAP_INIT=$init
EOF

# --disable-workspace-trust: the server tells the web client enableWorkspaceTrust=false
# (src/vs/server/node/webClientServer.ts), so the workspace never opens in Restricted
# Mode and flowleap.patent-ai activates on first load (#521 finding). The VM has one
# user and one folder, which that user owns, so there is nothing to restrict.
# --hosted-user-data: the web client keeps settings, browser state and secrets in the
# server's data folder (~flowleap/.flowleap-server/data/User), not in the browser's
# IndexedDB, so a new browser or cleared site data finds them again (#547).
server_cmd=("$prefix/bin/flowleap-server" --host 127.0.0.1 --port "$server_port" --without-connection-token --accept-server-license-terms --disable-workspace-trust --hosted-user-data "$workspace")
proxy_cmd=("$prefix/node" /usr/local/lib/flowleap/anthropic-proxy.ts)

log "Services ($init)"
if [ "$init" = systemd ]; then
	cat > /etc/systemd/system/flowleap-anthropic-proxy.service <<EOF
[Unit]
Description=FlowLeap Hosted Workspace Anthropic key proxy (127.0.0.1:$proxy_port)
After=network-online.target
Wants=network-online.target

[Service]
User=$proxy_user
Group=$proxy_user
EnvironmentFile=$etc/anthropic-proxy.env
ExecStart=${proxy_cmd[*]}
Restart=always
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ProtectProc=invisible

[Install]
WantedBy=multi-user.target
EOF
	cat > /etc/systemd/system/flowleap-server.service <<EOF
[Unit]
Description=FlowLeap Hosted Workspace server ($host)
After=network-online.target flowleap-anthropic-proxy.service
Wants=network-online.target flowleap-anthropic-proxy.service

[Service]
User=$user
Group=$user
WorkingDirectory=$home
EnvironmentFile=$etc/server.env
ExecStart=${server_cmd[*]}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
	systemctl daemon-reload
	systemctl enable --now flowleap-anthropic-proxy.service
	systemctl enable flowleap-server.service
	systemctl restart flowleap-server.service
else
	# Same users, env files and commands as the units; no sandboxing options.
	install -d -m 0755 /run/flowleap /var/log/flowleap
	for pidfile in /run/flowleap/*.pid; do
		[ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null || true
	done
	# shellcheck source=/dev/null
	(set -a; . "$etc/anthropic-proxy.env"; set +a
		exec setpriv --reuid="$proxy_user" --regid="$proxy_user" --init-groups -- "${proxy_cmd[@]}") >/var/log/flowleap/proxy.log 2>&1 &
	echo $! > /run/flowleap/flowleap-anthropic-proxy.pid
	# shellcheck disable=SC2046 # server.env holds KEY=value lines without spaces
	(cd "$home" && exec env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin $(cat "$etc/server.env") \
		setpriv --reuid="$user" --regid="$user" --init-groups -- "${server_cmd[@]}") >/var/log/flowleap/server.log 2>&1 &
	echo $! > /run/flowleap/flowleap-server.pid
fi

log "TLS ($tls)"
webroot=/var/www/letsencrypt
install -d -m 0755 "$webroot"
if [ "$tls" = letsencrypt ]; then
	cert=/etc/letsencrypt/live/$host/fullchain.pem
	key=/etc/letsencrypt/live/$host/privkey.pem
else
	cert=$etc/tls/$host.crt
	key=$etc/tls/$host.key
	install -d -m 0700 "$etc/tls"
	openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$host" -addext "subjectAltName=DNS:$host" \
		-keyout "$key" -out "$cert" 2>/dev/null
fi

rm -f /etc/nginx/sites-enabled/default
nginx_reload() {
	nginx -t -q
	if [ "$init" = systemd ]; then
		systemctl enable nginx >/dev/null 2>&1 || true
		systemctl reload-or-restart nginx
	elif pgrep -x nginx >/dev/null; then
		nginx -s reload
	else
		nginx
	fi
}

# Port 80 first: the ACME challenge and a redirect to HTTPS.
cat > "/etc/nginx/sites-available/$host" <<EOF
server {
	listen 80;
	listen [::]:80;
	server_name $host;
	location /.well-known/acme-challenge/ { root $webroot; }
	location / { return 301 https://\$host\$request_uri; }
}
EOF
ln -sf "/etc/nginx/sites-available/$host" "/etc/nginx/sites-enabled/$host"
nginx_reload
if [ "$tls" = letsencrypt ] && [ ! -f "$cert" ]; then
	certbot certonly --webroot -w "$webroot" -d "$host" --non-interactive --agree-tos \
		-m "${FLOWLEAP_CERTBOT_EMAIL:-ops@flowleap.co}" --deploy-hook "systemctl reload nginx"
fi

# No auth cache (#542): one backend call per request; the route has its own 600/min limiter.
cat > /etc/nginx/conf.d/flowleap-hosted.conf <<'EOF'
# The hosted sign-in stores the user's long-lived FlowLeap token in the fl_hosted cookie
# on this host (the Clerk __session cookie of the website is not sent to *.app.flowleap.co).
# The backend accepts that token only as a Bearer, so the auth subrequest sends it as one.
map $cookie_fl_hosted $hosted_authorization {
	""      $http_authorization;
	default "Bearer $cookie_fl_hosted";
}

map $http_upgrade $connection_upgrade {
	default upgrade;
	""      close;
}
EOF

api_host="$(printf '%s' "$authorize_url" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')"
callback="https://$host/_flowleap/callback"
callback_enc="$(printf '%s' "$callback" | sed -e 's#:#%3A#g' -e 's#/#%2F#g')"
cat > "/etc/nginx/sites-available/$host" <<EOF
server {
	listen 80;
	listen [::]:80;
	server_name $host;
	location /.well-known/acme-challenge/ { root $webroot; }
	location / { return 301 https://\$host\$request_uri; }
}

server {
	listen 443 ssl http2;
	listen [::]:443 ssl http2;
	server_name $host;

	ssl_certificate     $cert;
	ssl_certificate_key $key;
	ssl_protocols       TLSv1.2 TLSv1.3;

	client_max_body_size 100m;

	# --- Gate: backend PR #550, docs/runbooks/hosted-workspace-authorize.md ---------
	location = /_hosted_authorize {
		internal;
		proxy_pass $authorize_url;
		proxy_pass_request_body off;
		proxy_set_header Content-Length "";
		proxy_set_header Host $api_host;
		# The gate uses only the fl_hosted bearer. Never forward the browser's cookies:
		# Clerk sets client cookies on flowleap.co, the browser sends them to
		# *.app.flowleap.co, and Clerk's middleware then answers with a 307 handshake
		# redirect, which auth_request turns into a 500 (#542). The Accept and Sec-Fetch-*
		# headers are blanked for the same reason: they make Clerk treat this as a navigation.
		proxy_set_header Cookie "";
		proxy_set_header Accept "application/json";
		proxy_set_header Sec-Fetch-Dest "";
		proxy_set_header Sec-Fetch-Mode "";
		proxy_set_header Sec-Fetch-Site "";
		# Origin/Referer: the backend's global CORS policy throws on an unknown Origin
		# (500), and script/XHR requests from the workbench carry one. Server-to-server
		# call: send neither.
		proxy_set_header Origin "";
		proxy_set_header Referer "";
		proxy_set_header Authorization \$hosted_authorization;
		proxy_ssl_server_name on;
		proxy_ssl_name $api_host;
		# No proxy_cache here (#542): a cached 204 failed the next auth_request with 500.
	}

	# --- Sign-in hand-over (no gate) --------------------------------------------------
	# 401 -> the patent-ai-agent OAuth flow with this host's callback (accepted by
	# backend #551/#552 and the website: https://<label>.app.flowleap.co/.../callback).
	location @hosted_signin {
		add_header Set-Cookie "fl_state=\$request_id; Path=/_flowleap/; Max-Age=900; Secure; HttpOnly; SameSite=Lax" always;
		return 302 "$api_origin/oauth/authorize?client_id=patent-ai-agent&response_type=token&redirect_uri=$callback_enc&state=\$request_id";
	}

	# The website returns here with token, state and expires_in. Check the state
	# against the cookie set above, keep the token in an HttpOnly cookie, go home.
	location = /_flowleap/callback {
		access_log off;
		if (\$cookie_fl_state = "") { return 403 "Sign-in expired. Open https://$host/ again.\n"; }
		if (\$arg_state != \$cookie_fl_state) { return 403 "Sign-in state mismatch. Open https://$host/ again.\n"; }
		if (\$arg_token !~ "^[A-Za-z0-9._-]+\$") { return 400 "Sign-in returned no token.\n"; }
		add_header Set-Cookie "fl_hosted=\$arg_token; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax" always;
		add_header Set-Cookie "fl_state=; Path=/_flowleap/; Max-Age=0; Secure; HttpOnly; SameSite=Lax" always;
		return 302 /;
	}

	location @hosted_forbidden {
		default_type text/plain;
		return 403 "This account is not invited to a FlowLeap Hosted Workspace.\n";
	}

	# --- The workspace -----------------------------------------------------------------
	location / {
		auth_request /_hosted_authorize;
		error_page 401 = @hosted_signin;
		error_page 403 = @hosted_forbidden;

		proxy_pass http://127.0.0.1:$server_port;
		proxy_http_version 1.1;
		proxy_set_header Host \$host;
		proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto \$scheme;
		proxy_set_header Upgrade \$http_upgrade;
		proxy_set_header Connection \$connection_upgrade;
		proxy_read_timeout 1d;
		proxy_send_timeout 1d;
		proxy_buffering off;
	}
}
EOF
nginx_reload

log "Wait for the server"
for _ in $(seq 1 60); do
	if curl -fsS -o /dev/null "http://127.0.0.1:$server_port/version" 2>/dev/null || curl -fsS -o /dev/null "http://127.0.0.1:$server_port/" 2>/dev/null; then
		break
	fi
	sleep 2
done

cat <<EOF

Installed: https://$host  (owner $owner)
Next (docs/hosted/README.md):
  1. Add $owner to HOSTED_ALLOWLIST in /opt/flowleap-backend/.env on the backend, then
     docker compose up -d  (never restart).
  2. Run: sudo $script_dir/verify.sh $name
EOF
