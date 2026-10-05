# Hosted Workspace: one VM per user

ADR 0011, PRD 0019, #507. This is how to set up a **Hosted Workspace** for one invited user on
one Ubuntu 24.04 VM, and how to remove it. The scripts are in `scripts/hosted/`. A built
package also has a copy of them in its `hosted/` folder.

## What runs on the VM

| Part | Listens on | User | Holds |
|---|---|---|---|
| nginx | `:80` (ACME and a redirect only), `:443` | `www-data` | TLS cert. It asks the backend about every request (`auth_request` to `/v1/hosted/authorize`). |
| `flowleap-server` (systemd) | `127.0.0.1:8000` | `flowleap` | The reh-web server, the extension host, the agent host, the pty host. Environment: `/etc/flowleap/server.env` (no secrets). |
| `flowleap-anthropic-proxy` (systemd) | `127.0.0.1:8787` | `flowleap-proxy` | The real Anthropic key. It is in `/etc/flowleap/anthropic-proxy.env` (root, 0600). |

The server has `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` and `ANTHROPIC_API_KEY=hosted-dummy`.
The browser terminal is a child of the server, so `echo $ANTHROPIC_API_KEY` in it prints
`hosted-dummy`. The proxy removes the caller's credentials and adds the real `x-api-key`.

![The browser terminal of a Hosted Workspace prints the dummy key](media/h2-terminal-dummy-key.png)

Sign-in to the workspace (the gate in nginx):

1. A request without a valid FlowLeap Session gets `401` from the backend. nginx then sends the
   browser to `https://api.flowleap.co/oauth/authorize?client_id=patent-ai-agent&redirect_uri=https://<name>.app.flowleap.co/_flowleap/callback&state=<id>`.
   The `state` is also put in an HttpOnly cookie.
2. The user signs in on the website. The website returns to `/_flowleap/callback` with `token`,
   `state` and `expires_in`.
3. nginx compares `state` with the cookie and keeps the token in the HttpOnly cookie
   `fl_hosted` (30 days). Then it sends the browser to `/`.
4. On each request, nginx sends `fl_hosted` to the backend as `Authorization: Bearer`:
   `204` lets the request through, `403` shows "not invited".

We do not use the website's Clerk `__session` cookie. It expires in about one minute. nginx
does **not** forward any browser cookie to the backend (#542). Clerk sets client cookies on the
root domain `flowleap.co`, so the browser sends them to `*.app.flowleap.co` too. If nginx
forwarded them, Clerk's middleware would answer the auth call with a `307` handshake redirect,
and `auth_request` turns that into a `500`. The auth call also sends `Accept: application/json`
and blank `Sec-Fetch-*` headers. The backend runbook text that says "forward the Cookie header"
is wrong for this setup (flowleap-backend issue filed from #542).

**No auth cache (decision, #542).** The first version cached `204`/`403` answers for 30 seconds
(`proxy_cache hosted_auth`). On the first VM, `GET /` passed, then the next asset requests failed
with `auth request unexpected status: 500`. Turning the cache off fixed it. We dropped the
cache: each request makes one backend call, and the route has its own limiter (600 per minute),
which is enough for one user. `verify.sh` checks that consecutive requests with a valid token
all succeed.

**Swap.** `install.sh` adds a 4 GB swapfile (mode 0600, `/etc/fstab`, `vm.swappiness=10`) when
the VM has less than 6 GB RAM and no swap. A 4 GB VM needs it. Running the script again changes
nothing.

Workspace trust: the server starts with `--disable-workspace-trust`. The server then tells
the web client that trust is off, so the folder does not open in Restricted Mode, and
`flowleap.patent-ai` activates on the first load. The VM has one user and one folder, and that
user owns the folder.

## Before you start (once per workspace)

- The package: `flowleap-server-web-<version>-linux-x64.tar.gz`, from
  `scripts/hosted/build-package.sh <ref> <out-dir>`. Build it on Linux x64 with Node 24.15.0.
  The script header has the `docker run … node:24.15.0-bookworm` command. The build takes about
  one hour under emulation on a Mac and about 15 minutes on a Linux machine.
- The invitee's Clerk user id (`user_…`). It is in the Clerk dashboard, under Users.
- A **new** Anthropic API key, for this workspace only (Anthropic Console → API keys). Give it a
  name such as `hosted-<name>`.

## Ten-minute checklist

1. **VM.** Make an Ubuntu 24.04 x64 VM with 2 vCPU, 4 GB RAM and 30 GB disk or more (install.sh adds swap on a VM with less than 6 GB RAM). Open
   ports 22, 80 and 443. Copy the package to the VM:
   `scp flowleap-server-web-*.tar.gz root@<ip>:/root/`.
2. **DNS.** Add an `A` record `<name>.app.flowleap.co → <VM IPv4>` (if the VM has IPv6, add
   `AAAA` too). Use DNS only, with no proxy: the WebSocket and certbot need the VM directly.
   Wait until `dig +short <name>.app.flowleap.co` returns the IP.
3. **Spend cap.** In the Anthropic Console, set a monthly spend limit on the workspace or
   organization that has this key (Settings → Limits). This is the only brake on inference
   cost in v1 (ADR 0011).
4. **Install.** On the VM:
   ```sh
   tar -xzf flowleap-server-web-*.tar.gz flowleap-server-web-*/hosted
   sudo flowleap-server-web-*/hosted/install.sh <name> /root/flowleap-server-web-<version>-linux-x64.tar.gz <clerk-user-id>
   ```
   It asks for the Anthropic key. The input is hidden. You can also put the key in
   `FLOWLEAP_ANTHROPIC_API_KEY`.
5. **Allowlist.** On the backend host (`ssh flowleap`), add the user id to
   `HOSTED_ALLOWLIST` (comma-separated) in `/opt/flowleap-backend/.env`. Then run
   `docker compose up -d` in `/opt/flowleap-backend`. Do not use `restart`: it does not read
   the env file again.
6. **Verify.** On the VM, run `sudo flowleap-server-web-*/hosted/verify.sh <name>`. All checks
   must pass. The checks: the units run, a signed-out visit goes to sign-in, every process of
   `flowleap` has only the dummy key, `flowleap` cannot read the key file or the proxy's
   environment, an Anthropic call through the proxy gives `200`, workspace trust is off, a bogus Clerk cookie
   still gives the sign-in redirect (never `500`), and swap is present. With
   `FLOWLEAP_VERIFY_TOKEN=<allowlisted token>` it also checks that three consecutive requests
   do not fail.
7. **Try it yourself first.** Temporarily add your own user id to the allowlist (step 5).
   Open `https://<name>.app.flowleap.co`, sign in, and do these steps:
   - In the terminal, `echo $ANTHROPIC_API_KEY` must print `hosted-dummy`.
   - In the Agents view, start an Agent Session with Claude. It must answer.
   - In the editor chat, "FlowLeap: Sign In" must work, and a Patent-data tool call must work.

   Then remove your id from the allowlist.
8. **Hand-over.** Send the invitee the text below.

### Evaluator hand-over text

> _Placeholder. The founder writes this text. Include: the URL
> `https://<name>.app.flowleap.co`, the account e-mail to sign in with, what the workspace is
> for, the data-handling page (the hosted section), how long the workspace stays, and who to
> contact._

## Remove a workspace

```sh
sudo flowleap-server-web-*/hosted/teardown.sh <name>
```

The script stops and removes both units. It removes the vhost and the certificate, the server,
the `flowleap` user with the workspace, and the key file. Then do these steps yourself:

1. **Revoke the Anthropic key** in the Anthropic Console. A copied key works until you revoke
   it.
2. Remove the user id from `HOSTED_ALLOWLIST` and run `docker compose up -d` on the backend.
3. Delete the DNS record. Then delete the VM, or reuse it.

## Known limits (v1)

- **The allowlist admits a user to every Hosted Workspace, not only to their own.**
  `/v1/hosted/authorize` answers "allowlisted or not". It does not answer "the owner of this
  VM". With one invitee this is the same thing. Before a second hosted user, the backend must
  return the user id on `204` (for example `X-FlowLeap-User`). nginx can then compare it with
  `FLOWLEAP_HOSTED_OWNER` in `/etc/flowleap/hosted.env`.
- A hosted user can spend through the proxy from inside their workspace. The spend cap is the
  limit.
- Sign-in through the gate needs backend #552 (`/oauth/authorize` accepts
  `https://<name>.app.flowleap.co/…/callback`) in production. Without it the authorize step
  answers `400 Invalid redirect_uri for this client`.

## Local proof without a VM (what #507 did)

On a Mac, in Docker, without systemd:

```sh
docker run -d --name fl-hosted --platform linux/amd64 --cap-add SYS_PTRACE -p 127.0.0.1:8443:443 \
  -v "$PWD/out:/pkg:ro" -v "$PWD/scripts/hosted:/hosted:ro" ubuntu:24.04 sleep infinity
docker exec -e FLOWLEAP_ANTHROPIC_API_KEY=sk-ant-… -e FLOWLEAP_TLS=self-signed -e FLOWLEAP_INIT=direct \
  fl-hosted bash /hosted/install.sh test /pkg/flowleap-server-web-<v>-linux-x64.tar.gz user_…
docker exec -e FLOWLEAP_VERIFY_LOCAL=1 fl-hosted bash /hosted/verify.sh test
```

How this is different from a VM:

- `FLOWLEAP_INIT=direct`: systemd does not run under amd64 emulation in Docker Desktop (every
  unit exits with 255/EXCEPTION). In this mode, install.sh starts the same two commands, with
  the same users and the same env files, through `setpriv`. The unit files are written and
  checked separately with `systemd-analyze verify`. The sandbox options of the proxy unit
  (`ProtectSystem`, `ProtectHome`, `ProtectProc`) are not tested.
- `FLOWLEAP_TLS=self-signed`: a 30-day self-signed certificate. Certbot is not run.
- `--cap-add SYS_PTRACE`: without it, root in a container cannot read `/proc/<pid>/environ`,
  so verify.sh cannot scan the processes. A VM does not need it.
- To load the workbench through the gate without production sign-in, set
  `FLOWLEAP_AUTHORIZE_URL` to a local stand-in that answers `204`.
