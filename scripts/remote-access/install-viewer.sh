#!/usr/bin/env bash
# Install or update the Remote Access Viewer site on the Hetzner box (PRD 0018 B4,
# docs/remote-access/VIEWER.md).
#
#   sudo scripts/remote-access/install-viewer.sh <flowleap-viewer-<version>.tar.gz>
#
# The tarball comes from build-viewer.sh --tarball (a release asset). The script:
#   - unpacks <version>/ into $root/<version>/ (a re-install of the same version replaces it)
#   - copies the site root files (index.html, loader.js, config.example.json) to $root/
#   - writes $root/config.json once, from FLOWLEAP_CLERK_PUBLISHABLE_KEY (kept on later runs)
#   - keeps the newest $keep builds, removes older ones, and writes $root/versions.json
#   - writes one nginx vhost for $domain and gets its certificate with certbot (webroot)
# It changes no other nginx site. Running it again with the same tarball changes nothing.
#
# Environment (defaults are production):
#   FLOWLEAP_VIEWER_DOMAIN          default remote.flowleap.co
#   FLOWLEAP_VIEWER_ROOT            default /var/www/remote-access
#   FLOWLEAP_VIEWER_KEEP            builds to keep, default 3
#   FLOWLEAP_API_ORIGIN             default https://api.flowleap.co (into config.json)
#   FLOWLEAP_CLERK_PUBLISHABLE_KEY  pk_live_… for config.json; needed on the first run only
#   FLOWLEAP_TLS                    letsencrypt (default) | none (nginx on :80 only, local proof)
#   FLOWLEAP_CERTBOT_EMAIL          default ops@flowleap.co
set -euo pipefail

tarball="${1:?usage: install-viewer.sh <flowleap-viewer-<version>.tar.gz>}"
domain="${FLOWLEAP_VIEWER_DOMAIN:-remote.flowleap.co}"
root="${FLOWLEAP_VIEWER_ROOT:-/var/www/remote-access}"
keep="${FLOWLEAP_VIEWER_KEEP:-3}"
api_origin="${FLOWLEAP_API_ORIGIN:-https://api.flowleap.co}"
tls="${FLOWLEAP_TLS:-letsencrypt}"
certbot_email="${FLOWLEAP_CERTBOT_EMAIL:-ops@flowleap.co}"
webroot=/var/www/letsencrypt
vhost="/etc/nginx/sites-available/$domain"

log() { printf '\n==> %s\n' "$*"; }
# systemd on the box; a container without it (local proof) runs nginx directly.
reload_nginx() {
	if [ -d /run/systemd/system ]; then
		systemctl reload nginx
	elif [ -f /run/nginx.pid ] && kill -0 "$(cat /run/nginx.pid)" 2>/dev/null; then
		nginx -s reload
	else
		nginx
	fi
}
die() { printf 'install-viewer: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (sudo)"
[ -f "$tarball" ] || die "no tarball at $tarball"
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || die "FLOWLEAP_VIEWER_KEEP must be a positive number"
case "$tls" in letsencrypt|none) ;; *) die "FLOWLEAP_TLS must be letsencrypt or none" ;; esac
command -v nginx >/dev/null || die "nginx is not installed"
command -v python3 >/dev/null || die "python3 is needed to write the JSON files"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
tar -xzf "$tarball" -C "$stage"
[ -f "$stage/site/index.html" ] && [ -f "$stage/site/loader.js" ] || die "the tarball has no site/index.html or site/loader.js"
version="$(find "$stage" -mindepth 1 -maxdepth 1 -type d ! -name site -exec basename {} \; | head -n 1)"
[[ "$version" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$ ]] || die "the tarball has no build folder"
[ -f "$stage/$version/out/vs/sessions/sessions.viewer.main.js" ] || die "$version/ has no out/vs/sessions/sessions.viewer.main.js"

log "Build $version -> $root/$version"
install -d -m 0755 "$root"
rm -rf "$root/$version.new"
mv "$stage/$version" "$root/$version.new"
chown -R root:root "$root/$version.new"
chmod -R u=rwX,go=rX "$root/$version.new"
rm -rf "${root:?}/${version:?}"
mv "$root/$version.new" "$root/$version"
# The install time orders the builds (newest first); the mtime of this marker records it.
touch "$root/$version/.installed"

log "Site root"
for file in index.html loader.js config.example.json; do
	install -m 0644 "$stage/site/$file" "$root/$file.new"
	mv "$root/$file.new" "$root/$file"
done
if [ ! -f "$root/config.json" ]; then
	key="${FLOWLEAP_CLERK_PUBLISHABLE_KEY:-}"
	[[ "$key" =~ ^pk_(live|test)_ ]] || die "first install: set FLOWLEAP_CLERK_PUBLISHABLE_KEY to the Clerk publishable key (pk_live_...)"
	KEY="$key" API="$api_origin" python3 -c 'import json, os; print(json.dumps({"clerkPublishableKey": os.environ["KEY"], "apiBaseUrl": os.environ["API"]}, indent="\t"))' > "$root/config.json.new"
	chmod 0644 "$root/config.json.new"
	mv "$root/config.json.new" "$root/config.json"
	echo "wrote $root/config.json"
else
	echo "kept $root/config.json"
fi

log "Keep the newest $keep builds"
mapfile -t builds < <(find "$root" -mindepth 2 -maxdepth 2 -name .installed -printf '%T@ %h\n' | sort -rn | awk '{print $2}' | xargs -r -n1 basename)
kept=()
for build in "${builds[@]}"; do
	if [ "${#kept[@]}" -lt "$keep" ]; then
		kept+=("$build")
	else
		echo "removing $build"
		rm -rf "${root:?}/$build"
	fi
done
LATEST="$version" python3 -c 'import json, os, sys; print(json.dumps({"latest": os.environ["LATEST"], "versions": sys.argv[1:]}, indent="\t"))' "${kept[@]}" > "$root/versions.json.new"
chmod 0644 "$root/versions.json.new"
mv "$root/versions.json.new" "$root/versions.json"
cat "$root/versions.json"

log "nginx vhost $domain"
install -d -m 0755 "$webroot"
cert="/etc/letsencrypt/live/$domain/fullchain.pem"
key_file="/etc/letsencrypt/live/$domain/privkey.pem"
if [ -f "$vhost" ]; then
	cp -p "$vhost" "/root/$domain.nginx.$(date +%Y%m%d%H%M%S).bak"
fi

# The site: static files only. The boot page is the same for every build, so every
# path that is not a file (/, /pair, /<version>/) gets index.html. Build folders are
# immutable (a new release is a new folder); the root files must never be cached.
site_locations() {
	cat <<NGINX
	root $root;
	index index.html;
	charset utf-8;
	gzip on;
	gzip_types text/css application/javascript application/json image/svg+xml application/wasm;
	add_header X-Content-Type-Options nosniff always;
	add_header Referrer-Policy no-referrer always;
	add_header X-Frame-Options DENY always;
	add_header Permissions-Policy "camera=(), microphone=()" always;

	location = /index.html { add_header Cache-Control "no-store" always; add_header X-Content-Type-Options nosniff always; add_header Referrer-Policy no-referrer always; add_header X-Frame-Options DENY always; }
	location ~ ^/(loader\.js|config\.json|versions\.json)$ { add_header Cache-Control "no-store" always; add_header X-Content-Type-Options nosniff always; }
	location ~ ^/[0-9A-Za-z][0-9A-Za-z.+-]*/(out|node_modules)/ {
		add_header Cache-Control "public, max-age=31536000, immutable" always;
		add_header X-Content-Type-Options nosniff always;
		try_files \$uri =404;
	}
	location ~ /\. { deny all; }
	location / { try_files \$uri /index.html; }
NGINX
}

if [ "$tls" = letsencrypt ] && [ ! -f "$cert" ]; then
	# First run: port 80 only, so certbot can answer the challenge.
	cat > "$vhost" <<NGINX
server {
	listen 80;
	listen [::]:80;
	server_name $domain;
	location /.well-known/acme-challenge/ { root $webroot; }
	location / { return 404; }
}
NGINX
	ln -sf "$vhost" "/etc/nginx/sites-enabled/$domain"
	nginx -t -q
	reload_nginx
	certbot certonly --webroot -w "$webroot" -d "$domain" --non-interactive --agree-tos -m "$certbot_email"
fi

if [ "$tls" = letsencrypt ]; then
	cat > "$vhost" <<NGINX
server {
	listen 80;
	listen [::]:80;
	server_name $domain;
	location /.well-known/acme-challenge/ { root $webroot; }
	location / { return 301 https://\$host\$request_uri; }
}

server {
	listen 443 ssl;
	listen [::]:443 ssl;
	http2 on;
	server_name $domain;
	ssl_certificate     $cert;
	ssl_certificate_key $key_file;
	ssl_protocols       TLSv1.2 TLSv1.3;
	add_header Strict-Transport-Security "max-age=31536000" always;
$(site_locations)
}
NGINX
else
	cat > "$vhost" <<NGINX
server {
	listen 80;
	listen [::]:80;
	server_name $domain;
$(site_locations)
}
NGINX
fi
ln -sf "$vhost" "/etc/nginx/sites-enabled/$domain"
nginx -t -q
reload_nginx

log "Check"
scheme=$([ "$tls" = letsencrypt ] && echo https || echo http)
for path in / "/$version/" /versions.json "/$version/out/vs/sessions/sessions.viewer.main.css"; do
	code="$(curl -s -o /dev/null -w '%{http_code}' --resolve "$domain:$([ "$tls" = letsencrypt ] && echo 443 || echo 80):127.0.0.1" "$scheme://$domain$path" || true)"
	printf '%s %s\n' "$code" "$path"
	[ "$code" = 200 ] || die "$path answered $code"
done
echo "The Viewer $version is live at $scheme://$domain/"
