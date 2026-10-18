# Remote Access — the Viewer page (PRD 0018 B4)

**Status:** built 2026-10-17 (#482). Vocabulary from `CONTEXT.md` → Remote Access: **Host**,
**Viewer**, **Pairing**, **Relay**, **Agent Session**. Wire contract: `RELAY-CONTRACT.md`.

The Viewer is the fork's web Agents Window with the generic remote agent host provider. It is a
static site at `https://remote.flowleap.co`: no server of its own. It signs in with Clerk, lists
the user's pairs, claims a Pairing, connects to the Relay, runs the end-to-end crypto, and then
drives the agent host protocol (AHP) of the Host. The Relay sees ciphertext only.

## Site layout

```
/var/www/remote-access/            (nginx root of remote.flowleap.co)
  index.html                       the boot page: the same for every build
  loader.js                        picks the build folder, loads its boot script
  config.json                      { clerkPublishableKey, apiBaseUrl }  (per site, never in a build)
  config.example.json
  versions.json                    { latest, versions: [newest first] }
  <version>/                       one build per FlowLeap release, the newest three are kept
    out/vs/sessions/sessions.viewer.main.js, .css    the workbench
    out/vs/sessions/contrib/remoteAccess/browser/viewer/remoteAccessViewerBoot.js
    out/…                          workers, media
    node_modules/                  textmate, xterm, … (the web client loads them at run time)
```

Every path that is not a file (`/`, `/pair`, `/<version>/`) gets `index.html`. The build folders
never change after install, so nginx caches them for a year; the root files are `no-store`.

## Boot flow

1. `index.html` loads `/loader.js`. The loader reads `config.json` and `versions.json`, takes the
   first path segment as the build when `versions.json` lists it (else the newest build), sets
   the file root to `/<build>/out/`, and imports that build's boot script. So the boot page and
   the workbench it starts always come from the same build.
2. The boot script loads the Clerk browser SDK from the Frontend API host in the publishable key
   and signs in (Clerk's sign-in component, in the page).
3. `/pair#<pairId>.<secret>` (the QR code): the page removes the secret from the address bar
   first. Then it finds the offer's `hostId` in `GET /v1/remote-access/pairs`, posts
   `POST /pairs/<pairId>/claim` with `HMAC-SHA256(secret, hostId)`, derives the pair key
   (contract section 5 step 4) and keeps it in IndexedDB (`flowleap-remote-access`). The secret
   is not kept. A pasted code does the same.
4. Otherwise the page shows the pairs: "Paired with this browser" (key here: **Follow**,
   **Remove**), "Paired with <viewer label>" (another device), and offers that wait for a code.
   The last pair this browser followed opens again by itself; `?hosts` shows the list.
5. **Follow** opens the Viewer socket once, only to read `peer.appVersion` from `welcome`. When a
   kept build has that version and it is not the loaded one, the page reloads into
   `/<appVersion>/` (contract section 8). When no kept build has it, the page stays and says so.
6. The page imports `sessions.viewer.main.js` and calls `create(document.body, { remoteAccessViewer,
   workspaceProvider })`. `remoteAccessViewer` carries the Relay URL, the pair id, the pair key,
   the Host label, the loaded build version, a token callback and a status callback
   (`platform/agentHost/common/remoteAccessViewer.ts`). The boot page of one build can start the
   workbench of another kept build, so that shape only grows.

## Transport

`platform/agentHost/browser/remoteAccessViewerTransport.ts` is an `IClientTransport`, a drop-in
for `WebSocketClientTransport`. `connect()`:

- opens the Viewer socket, sends `hello` (role viewer, a fresh Clerk session token, pair id);
- on `welcome` with the Host online, and on every `{"t":"host","online":true}`, sends the
  Viewer's handshake first (section 6.1); the Host answers; `connect()` resolves;
- while the Host is offline it stays pending and reports `HostOffline`. "Host offline" is a page
  banner, not an error;
- a Host that goes offline after that closes the transport; the protocol client then reconnects
  through a new transport, which waits for the Host;
- no Host answer to the handshake in 15 s (a pair key that is out of date) closes the socket, and
  the client tries again.

After the handshake it seals each AHP message with `remoteAccessCrypto.ts` (chunks under the 1 MiB
Relay limit) and opens each Host frame, in strict order. It pings every 25 s.

Close codes and what the page says:

| Code | Page state | Retry |
|---|---|---|
| 4401 | "The Relay did not accept your FlowLeap sign-in. Sign in again." | no |
| 4402 | "Remote Access needs an active FlowLeap subscription or trial." | no |
| 4403 | "This pairing was removed. Pair this Viewer again on the Host." (the local key is deleted) | no |
| 4408 | idle: connecting again | yes |
| 4409 | "This pairing opened in another tab…" (another tab took the pair) | no |
| 4413 | a message was too large: connecting again | yes |
| 4429 | "Five Viewers already follow this Host. Close one, then try again." | no |

After a "no" the Viewer's connection factory fails every later transport at once, so two tabs
never take the pair from each other without end. Reload to try again.

## Provider registration

`src/vs/sessions/sessions.viewer.main.ts` is the Viewer entry. It imports the plain web entry and
adds, for the Viewer only:

- `contrib/remoteAccess/browser/viewer/remoteAccessViewer.contribution.ts`: the Viewer's
  `IRemoteAgentHostService` (`RemoteAccessViewerAgentHostService`), the workbench integration of a
  remote connection (`RemoteAgentHostContribution`: file system, agents, models, authentication)
  and the remote host enable setting. The service has exactly one entry, the pair's Host, and
  dials it through the Relay transport (address `remote-access-<pairId>`).
- the WebSocket-kind entry provider (`webSocketAgentHost.contribution.ts`), the agent picker,
  subagent chats and the phone chat-input pickers.

Cloud sandboxes, GitHub, tunnels, SSH and WSL stay out. One provider lists every agent the Host
publishes: `claude` now, `flowleap-chat` after slice C. The desktop entries do not change.

## Build

```
scripts/remote-access/build-viewer.sh [--version <v>] [--out out-viewer] [--tarball <dir>] [--no-minify]
```

It runs the esbuild `viewer` target (`build/next/index.ts`: the Viewer entry, the boot script, the
loader, the workers), copies `remote/web/node_modules` without what `build/.webignore` drops, and
writes the site root. The version is the FlowLeap version the Host sends: `--version`, else
`FLOWLEAP_VERSION`, else `product.json` `flowleapVersion`, else the package version (what an
unstamped dev Host sends). About 10 s after `npm ci`; macOS or Linux.

The Host sends `productService.flowleapVersion ?? productService.version` as `appVersion`.
`build/flowleap/stamp-flowleap-version.mjs` writes `flowleapVersion` into the built `product.json`
at release time, so a release Host and its Viewer build agree on `0.9.0`, not on the upstream
package version that every FlowLeap release shares.

The release workflow job `viewer` builds `flowleap-viewer-<version>.tar.gz` and attaches it next
to the installers (`publish-public-release.sh` copies it to `flowleap-releases` with them). A dry
run keeps it as a workflow artifact.

## Install on the box (manual, once per release)

```
curl -fsSLO https://github.com/abdullahatrash/flowleap-releases/releases/download/v<version>/flowleap-viewer-<version>.tar.gz
sudo FLOWLEAP_CLERK_PUBLISHABLE_KEY=pk_live_… scripts/remote-access/install-viewer.sh flowleap-viewer-<version>.tar.gz
```

The key is needed on the first run only; later runs keep `config.json`. The script writes one
nginx vhost (`/etc/nginx/sites-available/remote.flowleap.co`), gets the certificate with certbot
(webroot `/var/www/letsencrypt`), unpacks the build, keeps the newest three (install order),
writes `versions.json` and checks four URLs. It changes no other nginx site. Install a release's
Viewer **before** Hosts update to it: a Host whose version has no build gets the newest build and
a warning banner.

## Ops steps before the first Viewer is live

1. **DNS:** `remote.flowleap.co` A (and AAAA) record to the Hetzner box (`46.224.143.253`).
2. **Clerk:** production instance allows `https://remote.flowleap.co` (a subdomain of the
   application domain; check Domains and "Allowed origins"). The publishable key is the website's.
3. **Backend CORS:** done. `https://remote.flowleap.co` is on the allowlist (a preflight to
   `https://api.flowleap.co/v1/remote-access/pairs` answered 204 with that origin on 2026-10-17).
4. **Relay on:** `REMOTE_ACCESS_ENABLED=true` on the backend and the nginx block for
   `/v1/remote-access/` (backend runbook `docs/runbooks/remote-access-relay.md`).
5. **Install:** the release Viewer tarball with `install-viewer.sh`, as above.

## Local proof

Proven 2026-10-17 on one Mac, with no production service:

- backend `main` in its own worktree, no `.env`: `REMOTE_ACCESS_ENABLED=true SKIP_AUTH=true`,
  a dummy Clerk key, in-memory pair store; the page's `config.json` uses `devToken` (honoured on
  localhost only);
- a Host made of B3's `RemoteAccessRelayProtocolServer` piped to the standalone agent host server
  (`agentHostServerMain.js`, Claude agent plus `--enable-mock-agent`, throwaway data folder);
- the Viewer site served by `install-viewer.sh` in an Ubuntu 24.04 container (nginx, `FLOWLEAP_TLS=none`).

Seen in Chrome: pairing with the pasted code; the Host's session list (a Claude session and mock
sessions) and its files; a Claude session's turns and changes; a new mock session, a message sent,
a turn followed while it ran, a permission prompt answered from the Viewer; "Host offline" when
the Host stopped and the reconnect when it came back; the reload from the newest build into the
Host's build, before boot and while the workbench ran.

Not proven here: the phone layout (it follows the device's operating system, not the window
width, so desktop Chrome shows the desktop layout), the real Clerk sign-in, the desktop Host's own
Remote Access switch and Pairing dialog in the same run (B3 UI), and TLS. B5 covers them on the
founder's phone.

`scripts/remote-access/serve-viewer.ts` serves a built site locally the way nginx does.
