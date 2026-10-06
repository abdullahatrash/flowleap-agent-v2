#!/usr/bin/env bash
# Check one Hosted Workspace after install.sh (ADR 0011, #507).
#
#   sudo scripts/hosted/verify.sh <name>
#
# Checks: the units run; the signed-out vhost answers with the sign-in redirect; every
# process of the workspace user (the server tree and so the browser terminal) sees only
# the dummy ANTHROPIC_API_KEY and never the real key; that user cannot read the key file
# or the proxy's environment; the proxy adds the key (an Anthropic call with the dummy key
# succeeds through it); the server sends enableWorkspaceTrust=false to the web client.
#
# FLOWLEAP_VERIFY_LOCAL=1 resolves <name>.<domain> to 127.0.0.1 (no DNS yet).
set -uo pipefail

name="${1:?usage: verify.sh <name>}"
etc=/etc/flowleap
[ "$(id -u)" = 0 ] || { echo "verify: run as root (sudo)" >&2; exit 1; }
[ -f "$etc/hosted.env" ] || { echo "verify: no $etc/hosted.env; run install.sh first" >&2; exit 1; }
# shellcheck source=/dev/null
. "$etc/hosted.env"
[ "$FLOWLEAP_HOSTED_NAME" = "$name" ] || { echo "verify: this VM hosts '$FLOWLEAP_HOSTED_NAME', not '$name'" >&2; exit 1; }
host="$FLOWLEAP_HOSTED_HOST"
user=flowleap
failures=0

pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }
check() { local label="$1"; shift; if "$@"; then pass "$label"; else fail "$label"; fi; }

main_pid() {
	if [ "$FLOWLEAP_INIT" = systemd ]; then
		systemctl show -p MainPID --value "$1.service"
	else
		cat "/run/flowleap/$1.pid" 2>/dev/null
	fi
}
running() {
	local pid
	if [ "$FLOWLEAP_INIT" = systemd ]; then
		systemctl is-active --quiet "$1.service"
	else
		pid="$(main_pid "$1")"
		[ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
	fi
}
env_value() { tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null | sed -n "s/^$2=//p"; }

echo "== Units"
check "flowleap-anthropic-proxy is running" running flowleap-anthropic-proxy
check "flowleap-server is running" running flowleap-server
if [ "$FLOWLEAP_INIT" = systemd ]; then
	check "nginx is running" systemctl is-active --quiet nginx
else
	check "nginx is running" sh -c "pgrep -x nginx >/dev/null"
fi

echo "== Vhost (signed out)"
curl_args=(-sS -o /dev/null --max-time 20 -w '%{http_code} %{redirect_url}')
[ "${FLOWLEAP_VERIFY_LOCAL:-0}" = 1 ] && curl_args+=(--resolve "$host:443:127.0.0.1")
[ "$FLOWLEAP_TLS" = self-signed ] && curl_args+=(-k)
answer="$(curl "${curl_args[@]}" "https://$host/")"
echo "      GET https://$host/ -> $answer"
case "$answer" in
	"302 "*"/oauth/authorize?client_id=patent-ai-agent"*"redirect_uri=https%3A%2F%2F$host%2F_flowleap%2Fcallback"*) pass "signed-out visit redirects to FlowLeap sign-in" ;;
	*) fail "signed-out visit redirects to FlowLeap sign-in (got: $answer)" ;;
esac

echo "== Gate stability (#542)"
# A bogus Clerk client cookie plus a browser Accept header must still redirect to sign-in.
# If nginx forwarded Cookie to the backend, Clerk would answer 307 and nginx would give 500.
answer="$(curl "${curl_args[@]}" -H 'Cookie: __client_uat=1' -H 'Accept: text/html' "https://$host/")"
echo "      GET https://$host/ with Cookie: __client_uat=1 -> $answer"
case "$answer" in
	"302 "*"/oauth/authorize?"*) pass "bogus Clerk cookie still redirects to sign-in (no 500)" ;;
	*) fail "bogus Clerk cookie still redirects to sign-in (got: $answer)" ;;
esac
token="${FLOWLEAP_VERIFY_TOKEN:-}"
if [ -n "$token" ]; then
	codes=""
	for path in / /version /favicon.ico; do
		code="$(curl "${curl_args[@]}" -H "Cookie: fl_hosted=$token" "https://$host$path" | cut -d' ' -f1)"
		codes="$codes $code"
	done
	echo "      3 consecutive requests with a valid token ->$codes"
	check "three consecutive requests with a valid token never fail with 5xx" sh -c "! echo '$codes' | grep -q '5[0-9][0-9]'"
	check "the first request with a valid token is served (not 302/401/403)" sh -c "echo '$codes' | grep -qE '^ (200|204|304|404)'"
else
	echo "      SKIP  consecutive-request check: set FLOWLEAP_VERIFY_TOKEN to an allowlisted fl_pat_ or FlowLeap token"
fi
if [ -n "$(swapon --show --noheadings 2>/dev/null)" ]; then
	echo "      swap: $(swapon --show --noheadings | awk '{print $1, $3}' | paste -sd, -)"
	pass "swap is present"
else
	echo "      swap: none (install.sh adds 4 GB when RAM < 6 GB)"
	if [ "$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)" -lt 6000000 ]; then fail "swap is present on a VM with < 6 GB RAM"; else pass "no swap needed (RAM >= 6 GB)"; fi
fi

echo "== Key isolation"
server_pid="$(main_pid flowleap-server)"
if [ -n "$server_pid" ] && [ -r "/proc/$server_pid/environ" ]; then
	# What `echo $ANTHROPIC_API_KEY` prints in a shell that inherits the live server environment,
	# which is what the pty host gives the browser terminal.
	# shellcheck disable=SC2016 # the inner bash expands $ANTHROPIC_API_KEY, not this shell
	seen="$(xargs -0 -a "/proc/$server_pid/environ" sh -c 'exec setpriv --reuid=flowleap --regid=flowleap --init-groups -- env -i "$@" bash -c "echo \"\$ANTHROPIC_API_KEY\""' _)"
	echo "      echo \$ANTHROPIC_API_KEY (server environment) -> $seen"
	check "server environment has the dummy key" test "$seen" = hosted-dummy
else
	fail "cannot read the server process environment"
fi
real_key="$(sed -n 's/^ANTHROPIC_API_KEY=//p' "$etc/anthropic-proxy.env")"
leaks=0
count=0
for pid in $(pgrep -u "$user"); do
	if [ ! -r "/proc/$pid/environ" ] || ! cat "/proc/$pid/environ" >/dev/null 2>&1; then
		[ -d "/proc/$pid" ] || continue
		echo "      pid $pid: cannot read its environment (a container needs --cap-add SYS_PTRACE)"
		leaks=$((leaks + 1))
		continue
	fi
	count=$((count + 1))
	value="$(env_value "$pid" ANTHROPIC_API_KEY)"
	if [ -n "$value" ] && [ "$value" != hosted-dummy ]; then
		echo "      pid $pid ($(cat "/proc/$pid/comm" 2>/dev/null)) has ANTHROPIC_API_KEY=$value"
		leaks=$((leaks + 1))
	fi
	if [ -n "$real_key" ] && tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -qF -- "$real_key"; then
		echo "      pid $pid ($(cat "/proc/$pid/comm" 2>/dev/null)) has the real key in its environment"
		leaks=$((leaks + 1))
	fi
done
echo "      scanned $count processes of user $user"
check "no process of user $user holds a key other than the dummy" test "$leaks" = 0
check "key file is root-only (0600 root:root)" test "$(stat -c '%a %U:%G' "$etc/anthropic-proxy.env")" = "600 root:root"
check "user $user cannot read the key file" sh -c "! setpriv --reuid=$user --regid=$user --init-groups -- cat $etc/anthropic-proxy.env >/dev/null 2>&1"
proxy_pid="$(main_pid flowleap-anthropic-proxy)"
check "user $user cannot read the proxy environment" sh -c "! setpriv --reuid=$user --regid=$user --init-groups -- cat /proc/$proxy_pid/environ >/dev/null 2>&1"

echo "== Proxy"
body="$(mktemp)"
status="$(curl -sS -o "$body" --max-time 20 -w '%{http_code}' -H 'x-api-key: hosted-dummy' -H 'anthropic-version: 2023-06-01' "http://127.0.0.1:$FLOWLEAP_PROXY_PORT/v1/models")"
echo "      GET /v1/models through the proxy with the dummy key -> $status $(head -c 200 "$body")"
rm -f "$body"
check "proxy adds the real key (Anthropic answers 200; 401 = the key in $etc/anthropic-proxy.env is wrong or revoked)" test "$status" = 200

echo "== Server"
check "server sends enableWorkspaceTrust=false (no Restricted Mode)" sh -c "curl -sS --max-time 20 http://127.0.0.1:$FLOWLEAP_SERVER_PORT/ | grep -q 'enableWorkspaceTrust&quot;:false'"
check "server keeps the web client's user data on the server (hostedUserData, #547)" sh -c "curl -sS --max-time 20 http://127.0.0.1:$FLOWLEAP_SERVER_PORT/ | grep -q 'hostedUserData&quot;:{'"
check "server issues the 32-byte secrets key" sh -c "test \"\$(curl -sS --max-time 20 -X POST http://127.0.0.1:$FLOWLEAP_SERVER_PORT/hosted-secret-key | wc -c)\" -eq 32"
check "secrets key file is owned by the server user, mode 0400" sh -c "test \"\$(stat -c '%U %a' $etc/hosted-secret.key)\" = 'flowleap 400'"

echo
if [ "$failures" = 0 ]; then
	echo "verify: all checks passed for https://$host"
else
	echo "verify: $failures check(s) failed for https://$host"
	exit 1
fi
