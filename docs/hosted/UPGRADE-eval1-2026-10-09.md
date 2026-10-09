# Upgrade eval1 and hand it over (2026-10-09)

Runbook for the live Hosted Workspace `eval1` (PRD 0019 H5). You run it by hand on the VM, as
root. It has no secrets. Each command block was run in a container (Ubuntu 24.04, `direct`
init, self-signed TLS, placeholder key, an authorize stand-in that answers `204` for one
bearer token) against a copy of the live state: the 2026-10-05 `install.sh` with package
`a7d06c55`, then the nginx hand fixes, then user state. See "What was tested" at the end.

- New package: `flowleap-server-web-6c391f0a-linux-x64.tar.gz`
- SHA-256: `017cf211d172e189aa0d82e77b806aec24d2881f53a057d1b644ec96d76b1985`
- Commit: `6c391f0a22900fabb67a26ac6bb0fd26972209a7` (main with #588, #591, #592)

## Why the order is: nginx first, then the package

`update.sh` runs `verify.sh` at the end, and the new `verify.sh` checks the new vhost
(`/_flowleap/session`, runtime DNS). The vhost of the live VM does not have the
`/_flowleap/session` location, so `update.sh` on the old vhost **fails and rolls back**. We saw this
in the test: 4 checks failed, the old package came back, the server ran again, user state was
not touched. So fix nginx first. The new nginx files work with the old server too.

`update.sh` does not touch nginx, `/etc/flowleap`, or the unit files. `install.sh` does touch
them, so it is not the safe way to do this (see "Why not install.sh again").

## 0. Copy the package to the VM (from your Mac)

```sh
cd /Users/abdullahatrash/flowleap/hosted-packages
shasum -a 256 flowleap-server-web-6c391f0a-linux-x64.tar.gz   # must print the hash above
scp flowleap-server-web-6c391f0a-linux-x64.tar.gz{,.sha256} root@2.28.96.171:/root/
```

## 1. Look at the VM before you change it (on the VM, as root)

```sh
cd /root
. /etc/flowleap/hosted.env; echo "$FLOWLEAP_HOSTED_NAME $FLOWLEAP_HOSTED_HOST $FLOWLEAP_INIT $FLOWLEAP_TLS"
ls -d /opt/flowleap-server*
grep -c -E 'resolver |session-locations|fl_session_request_ok' /etc/nginx/sites-available/$FLOWLEAP_HOSTED_HOST /etc/nginx/conf.d/flowleap-hosted.conf
# keep a copy of everything the next steps can touch (no secret is printed)
cp -a /etc/flowleap /root/etc-flowleap.pre-upgrade
cp -a /etc/nginx/sites-available/$FLOWLEAP_HOSTED_HOST /root/vhost.pre-upgrade
sha256sum /home/flowleap/.flowleap-server/data/User/secrets.json /etc/flowleap/hosted-secret.key | tee /root/state.pre-upgrade.sha256
```

`FLOWLEAP_INIT` must be `systemd` and `FLOWLEAP_TLS` must be `letsencrypt` on eval1.

## 2. Fix nginx (on the VM, as root)

This script changes only two nginx files and one new file. It makes a backup first, adds
each piece only when it is missing (you can run it again), and runs `nginx -t` before the
reload. If the test fails it puts both files back and does not reload.
It adds: the `$fl_session_request_ok` map (#592), the `/_flowleap/session` locations (#592,
in `/etc/flowleap/session-locations.conf`, with one `include` line in the vhost), the
resolver and the variable `proxy_pass` (#544) if the vhost lacks them, and the nginx restart
drop-in (#546) if it is missing.

```sh
cat > /root/nginx-fix.sh <<'SCRIPT'
set -eu
. /etc/flowleap/hosted.env
HOST=$FLOWLEAP_HOSTED_HOST
V=/etc/nginx/sites-available/$HOST
C=/etc/nginx/conf.d/flowleap-hosted.conf
B=/etc/flowleap/backup
S=$(date +%Y%m%d%H%M%S)

# 0. Back up the two nginx files (outside sites-enabled).
install -d -m 0755 $B
cp -a $V $B/$HOST.pre-upgrade.$S
cp -a $C $B/flowleap-hosted.conf.pre-upgrade.$S

# 1. The map for /_flowleap/session (#592). Added once.
grep -q fl_session_request_ok $C || cat >> $C <<'EOF'

# /_flowleap/session (#548) answers only a request from the workbench itself: it must carry
# X-FlowLeap-Hosted: 1 (a cross-site page cannot send it without a CORS preflight, which this
# host refuses), and a browser that sends Sec-Fetch-Site must say same-origin.
map "$http_x_flowleap_hosted:$http_sec_fetch_site" $fl_session_request_ok {
	default        0;
	"1:"           1;
	"1:same-origin" 1;
}
EOF

# 2. The session locations, in their own file; the vhost gets one include line.
cat > /etc/flowleap/session-locations.conf <<'EOF'
# --- Single sign-in (#548) --------------------------------------------------------------
location = /_flowleap/session {
	access_log off;
	default_type application/json;
	add_header Cache-Control "no-store" always;
	if ($fl_session_request_ok = 0) { return 403 '{"error":"forbidden"}\n'; }
	if ($cookie_fl_hosted !~ "^[A-Za-z0-9._-]+$") { return 401 '{"error":"no session"}\n'; }
	auth_request /_hosted_authorize;
	error_page 401 = @hosted_session_unauthorized;
	error_page 403 = @hosted_forbidden;
	root /nonexistent;
	try_files /nonexistent @hosted_session_body;
}

location @hosted_session_body {
	access_log off;
	default_type application/json;
	add_header Cache-Control "no-store" always;
	return 200 '{"token":"$cookie_fl_hosted"}\n';
}

location @hosted_session_unauthorized {
	default_type application/json;
	add_header Cache-Control "no-store" always;
	return 401 '{"error":"no session"}\n';
}
EOF
grep -q session-locations.conf $V || sed -i 's#^\tlocation / {$#\tinclude /etc/flowleap/session-locations.conf;\n\n&#' $V

# 3. Resolver (#544) and variable proxy_pass, only if the vhost lacks them.
grep -qE '^[[:space:]]*resolver ' $V || sed -i 's#^\tssl_protocols .*#&\n\n\tresolver 185.12.64.1 185.12.64.2 1.1.1.1 valid=300s ipv6=off;#' $V
grep -q 'proxy_pass \$flowleap_authorize;' $V || sed -i -E 's#^(\t\t)proxy_pass (https?://[^;]*/v1/hosted/authorize);#\1set $flowleap_authorize \2;\n\1proxy_pass $flowleap_authorize;#' $V

# 4. nginx restart drop-in (#546), only if missing. Needs systemd (skipped in a container).
if [ -d /run/systemd/system ] && [ ! -f /etc/systemd/system/nginx.service.d/flowleap-restart.conf ]; then
	install -d -m 0755 /etc/systemd/system/nginx.service.d
	cat > /etc/systemd/system/nginx.service.d/flowleap-restart.conf <<'EOF'
[Unit]
StartLimitIntervalSec=0

[Service]
Restart=on-failure
RestartSec=5s
EOF
	systemctl daemon-reload
fi

# 5. Test, then reload. If the test fails, put both files back and stop.
if nginx -t; then
	systemctl reload nginx
	echo "nginx reloaded"
else
	cp -a $B/$HOST.pre-upgrade.$S $V
	cp -a $B/flowleap-hosted.conf.pre-upgrade.$S $C
	echo "nginx -t FAILED: both files restored, nginx not reloaded" >&2
	exit 1
fi
SCRIPT
bash /root/nginx-fix.sh
```

Expected: `nginx reloaded`. Check it:

```sh
. /etc/flowleap/hosted.env
curl -sS -o /dev/null -w '%{http_code}\n' -H 'X-FlowLeap-Hosted: 1' https://$FLOWLEAP_HOSTED_HOST/_flowleap/session   # 401 (header, no cookie)
curl -sS -o /dev/null -w '%{http_code}\n' https://$FLOWLEAP_HOSTED_HOST/_flowleap/session                           # 403 (no header)
curl -sSI https://$FLOWLEAP_HOSTED_HOST/ | head -1                                                                  # 302 (sign-in)
```

If anything is wrong, put the old files back:

```sh
. /etc/flowleap/hosted.env
cp -a /root/vhost.pre-upgrade /etc/nginx/sites-available/$FLOWLEAP_HOSTED_HOST
ls /etc/flowleap/backup/flowleap-hosted.conf.pre-upgrade.*   # copy the newest one over /etc/nginx/conf.d/flowleap-hosted.conf
nginx -t && systemctl reload nginx
```

## 3. Update the package (on the VM, as root)

```sh
cd /root
tar -xzf flowleap-server-web-6c391f0a-linux-x64.tar.gz flowleap-server-web-6c391f0a-linux-x64/hosted
sudo bash flowleap-server-web-6c391f0a-linux-x64/hosted/update.sh /root/flowleap-server-web-6c391f0a-linux-x64.tar.gz
```

It checks the hash against the `.sha256` file, unpacks to `/opt/flowleap-server.new`, stops the
server, keeps the old package as `/opt/flowleap-server.prev`, starts the new one, waits for
`Extension host agent started`, and runs `verify.sh`. If a step fails it puts the old package
back and exits with 1. The server is down for about 20 to 40 seconds.

On success the last lines are:

```
Installed product path: oss-6c391f0a22900fabb67a26ac6bb0fd26972209a7
Previous package kept at /opt/flowleap-server.prev. User state was not touched.
```

`verify.sh` must say `all checks passed`. On eval1 the proxy check passes, because the real
key is in `/etc/flowleap/anthropic-proxy.env`. (A hash mismatch, a missing `.sha256` file or
a failed check shows as an error before or after the swap; read it, do not retry blindly.)

## 4. Prove that user state survived (on the VM)

```sh
sha256sum -c /root/state.pre-upgrade.sha256            # both lines: OK
ls -la /home/flowleap/.flowleap-server/data/User       # settings.json, secrets.json, workspaceStorage are still there
sed -n 's/^[[:space:]]*"commit":[[:space:]]*"\([^"]*\)".*/\1/p' /opt/flowleap-server/product.json | head -1   # 6c391f0a22900fabb67a26ac6bb0fd26972209a7
```

Then, in a browser that is signed in to `https://eval1.app.flowleap.co`, open the workbench.
Check that the FlowLeap sidebar shows you as signed in without a second sign-in (#548), and
that your settings and chat list are still there.

For a full `verify.sh` run with the session checks, give it an allowlisted token (the value of
the `fl_hosted` cookie of a signed-in browser, or a `fl_pat_` token):

```sh
FLOWLEAP_VERIFY_TOKEN=<token> bash /root/flowleap-server-web-6c391f0a-linux-x64/hosted/verify.sh eval1
```

## 5. Hand over to the new evaluator (on the VM, then on the backend)

Only do this when the old evaluator has finished. It deletes their data.

```sh
bash /root/flowleap-server-web-6c391f0a-linux-x64/hosted/reset.sh eval1 --yes
```

It stops the server, deletes `settings.json`, `browserState*.json`, `secrets.json`,
`workspaceStorage`, most of `globalStorage`, `/home/flowleap/workspace` and
`/home/flowleap/FlowLeap Projects`, makes an empty workspace, and starts the server. The
package, `/etc/flowleap` (including `hosted-secret.key`), the vhost and the Anthropic key stay.
Check:

```sh
ls /home/flowleap/.flowleap-server/data/User /home/flowleap/workspace    # no settings.json, no secrets.json, empty workspace
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/          # 200
bash /root/flowleap-server-web-6c391f0a-linux-x64/hosted/verify.sh eval1  # all checks passed
```

Then do the steps that `reset.sh` cannot do (it prints them):

1. On the backend (`ssh flowleap`), in `/opt/flowleap-backend/.env`: remove the old evaluator's
   Clerk id from `HOSTED_ALLOWLIST` and add the new one. Then `cd /opt/flowleap-backend &&
   docker compose up -d`. Never `restart`. The old evaluator's 30-day `fl_hosted` token stays
   valid until the id is gone from the allowlist.
2. Rotate any BYOK key the old evaluator entered (EPO, USPTO, OpenRouter, ...). Rotate the
   Anthropic key of the workspace too if the old evaluator could read it.
3. Send the new evaluator the hand-over text (`docs/hosted/README.md`).

## Roll back the package

`update.sh` rolls back by itself when its checks fail. To go back later by hand:

```sh
systemctl stop flowleap-server
rm -rf /opt/flowleap-server && mv /opt/flowleap-server.prev /opt/flowleap-server
ln -sf /opt/flowleap-server/flowleap-cli/flowleap /usr/local/bin/flowleap
systemctl start flowleap-server
```

The old package does not need the new nginx files; the new nginx files do not need the new package.

## Why not `install.sh` again

We tested a second `install.sh <name> <new tarball> <owner>` over the live instance. It ends
with exit 0 and user state is intact, but it is a full re-install, not an upgrade:

| Item | After the second `install.sh` |
|---|---|
| `settings.json`, `secrets.json`, `workspaceStorage`, workspace files | kept (same hash) |
| `hosted-secret.key` (content, owner, mode, inode) | kept (made only when missing) |
| `/etc/flowleap/anthropic-proxy.env` | **written again** from the key you give it (`FLOWLEAP_ANTHROPIC_API_KEY` or the prompt). Any hand-added line in it is lost. If you give a wrong key, the proxy is broken. |
| `/etc/flowleap/server.env` | **written again**. Hand-added lines are lost (the test line `FLOWLEAP_HAND_EDIT` was lost). `PATENT_API_URL` goes back to the default unless you export it. |
| `/etc/flowleap/hosted.env` | written again with the same values |
| nginx vhost | **written again** (the hand fixes are replaced by the generated file; a copy goes to `/etc/flowleap/backup/`). The port-80-only vhost is live for a moment, so HTTPS is down for a few seconds. |
| certificate | Let's Encrypt: kept, certbot does not run when the cert exists. (`self-signed`, test only: made again.) |
| server package | **replaced with no rollback copy** (`.prev` is not made), no `verify.sh`, no health wait |
| services | proxy and server restarted |
| prompts | asks for the Anthropic key when the variable is not set |

It is idempotent for data, but not for configuration, and it has no rollback. Use the nginx
script and `update.sh`, which touch only what must change.

## What was tested

Container `ubuntu:24.04`, `FLOWLEAP_INIT=direct`, `FLOWLEAP_TLS=self-signed`. The authorize
stand-in answered `204` for `Authorization: Bearer goodtoken` and `401` otherwise. A fake
Anthropic upstream (`PROXY_UPSTREAM`) answered the proxy check.

1. Old package `a7d06c55` installed with its own `hosted/install.sh`. User state written:
   `settings.json`, 64 random bytes in `secrets.json`, a `workspaceStorage` file, and
   `workspace/notes.md`. Hand fixes added to the vhost (resolver) and `server.env`.
2. `update.sh` first (before the nginx fix): server updated, `verify.sh` failed 4 checks
   (variable `proxy_pass`, three `/_flowleap/session` checks), **rollback worked**, old
   server running, state intact.
3. After the nginx script (run twice: the second run changed nothing; each piece exists
   once), `update.sh` passed: `all checks passed`, `Installed product path:
   oss-6c391f0a22900fabb67a26ac6bb0fd26972209a7`.
4. State after the update: `settings.json`, `secrets.json`, `hosted-secret.key`, TLS files and
   `notes.md` have the same SHA-256 as before.
5. `/_flowleap/session` through nginx: no header 403; header, no cookie 401; bad token 401;
   good token with `Sec-Fetch-Site: same-origin` 200 with `{"token":"goodtoken"}` and
   `Cache-Control: no-store`; cross-site 403. `verify.sh` with the token: all checks passed.
6. `reset.sh eval1 --yes`: `settings.json`, `secrets.json`, `workspaceStorage` and `notes.md`
   gone, empty workspace, server answers 200, `verify.sh` all checks passed.

Not tested in the container (they need the VM): `systemctl` (the stop and start paths of
`update.sh` and `reset.sh` use the same commands as install's units; a `systemctl reload nginx`
shim was used), certbot, the nginx restart drop-in (the script writes it only under systemd),
the real Anthropic key and the real backend.
