# Remote Access — Relay wire contract (v1)

**Status:** DRAFT 2026-10-17 (PRD 0018 B1, #479). Decides nothing new: executes ADR 0009
decisions 4 and 5. Vocabulary from `CONTEXT.md` → Remote Access: **Host**, **Viewer**,
**Pairing**, **Relay**, **Agent Session**, **FlowLeap Session**.

The Relay joins one Host (a signed-in desktop) to its paired Viewers (a phone, a tablet, another
computer). It checks that both ends are the same FlowLeap user with an entitled subscription, then
forwards bytes it cannot read. It stores pair records, never content, and holds nothing while a
Host is offline.

## 1. Addresses

| Role | URL | Process |
|---|---|---|
| Host socket | `wss://api.flowleap.co/v1/remote-access/host` | FlowLeap desktop, outbound |
| Viewer socket | `wss://api.flowleap.co/v1/remote-access/viewer` | Viewer page in a browser, outbound |
| Pair management | `https://api.flowleap.co/v1/remote-access/pairs` (REST, below) | both |
| Viewer page | `https://remote.flowleap.co/<app-version>/` | static web build, nginx on the Hetzner box |

`app.flowleap.co` is the Hosted Workspace parent domain (ADR 0011) and is not used here.

The Relay is a WebSocket route inside `flowleap-backend` (the existing Node process, package
`ws`, mounted after `clerkMiddleware` like `/mcp`). nginx on `api.flowleap.co` adds, for
`location /v1/remote-access/`, `proxy_http_version 1.1`, the `Upgrade`/`Connection` headers and
`proxy_read_timeout 3600s`.

## 2. Identities

| Name | Who mints it | Where it lives |
|---|---|---|
| `userId` | Clerk | the FlowLeap Session token on both ends |
| `hostId` | the desktop, UUID v4 once per install | machine-local storage on the Host |
| `pairId` | the Relay, UUID v4 at pairing | Valkey `ra:pair:<pairId>`, and both ends' local storage |
| `pairSecret` | the desktop, 128 random bits at pairing | the QR code / pasteable code; the Host and the Viewer only; **never sent to the Relay** |

A pair binds one `hostId` to one Viewer for one `userId`. A user may have many Hosts and many
pairs per Host. Several Viewers may be live on one Host (cap: 5 sockets per Host).

## 3. Authentication and entitlement

Browsers cannot set WebSocket headers, so authentication is the **first frame** on every socket,
sent within 5 s of open, as a text frame:

```json
{ "t": "hello", "role": "host" | "viewer", "token": "<FlowLeap Session token>",
  "hostId": "<uuid>",            // host only
  "pairId": "<uuid>",            // viewer only
  "appVersion": "0.8.0",         // host only: the desktop app version, for the Viewer's build pick
  "ahp": [ /* AHP protocol versions the host serves, e.g. [3] */ ] }
```

The Relay runs the existing `requireAuth` logic on `token` (Clerk session or `flowleap`
JWT-template token; personal API tokens and OAuth tokens are refused: close `4401`), then the
subscription gate (`active` or `trialing`, the same answer `resolvePatentKeys` uses: otherwise
close `4402 subscription_required`). A Host whose `hostId` already has a live socket replaces it
(the older socket closes `4409`). A Viewer whose `pairId` is unknown, revoked, or belongs to
another user closes `4403`. On success the Relay answers:

```json
{ "t": "welcome", "pairs": [ /* host only: live pairIds for this hostId */ ],
  "peer": { "online": true|false, "appVersion": "0.8.0", "ahp": [3] } }   // viewer only
```

No token is ever echoed, logged or stored. The Relay keeps `userId`, `hostId`, `pairId`, the
socket, and `appVersion`/`ahp` in memory only.

## 4. Frames after `welcome`

Every frame is either **control** (text, JSON, plaintext, small) or **payload** (binary, the
Relay does not parse). The Relay forwards payload frames unchanged between a Host and the Viewers
of its live pairs, and tags each Viewer-originated payload with the pair it came from so the Host
can route the reply.

| Direction | Frame | Relay action |
|---|---|---|
| Host → Relay | binary `[0x01][pairId 16 bytes][ciphertext]` | forward `[0x01][ciphertext]` to that Viewer |
| Host → Relay | binary `[0x02][ciphertext]` | forward to **all** live Viewers of the Host (broadcast) |
| Viewer → Relay | binary `[0x01][ciphertext]` | forward `[0x01][pairId][ciphertext]` to the Host |
| either → Relay | `{"t":"ping"}` | `{"t":"pong"}` |
| Relay → Host | `{"t":"viewer","pairId":…,"online":true|false}` | on Viewer connect/disconnect |
| Relay → Viewer | `{"t":"host","online":true|false,"appVersion":…,"ahp":[…]}` | on Host connect/disconnect |
| Host → Relay | `{"t":"attention","pairId":"*"}` | content-free; stored only as "last attention at" per pair for B6 push |
| Relay → either | close `4408` | idle: no frame for 60 s (clients ping every 25 s) |

Limits: payload frame ≤ 1 MiB; control frame ≤ 4 KiB; a frame over the limit closes `4413`.
The Relay never buffers: if a Viewer is offline, Host payload to that pair is dropped; the Host
learns through the `viewer` control frame and resends state on reconnect (the AHP client
re-initializes anyway).

## 5. Pairing

1. **Host offers.** The desktop generates `pairSecret` (128 bits) and calls
   `POST /v1/remote-access/pairs` with `{ hostId, hostLabel, proof: HMAC-SHA256(pairSecret, hostId) }`.
   The Relay stores `ra:pair:<pairId> = { userId, hostId, hostLabel, proof, state: "offered",
   createdAt }` with a 10-minute TTL and returns `{ pairId }`.
2. **Host shows the code.** The QR encodes `https://remote.flowleap.co/pair#<pairId>.<pairSecret-base32>`.
   The pasteable code is the same `pairId.pairSecret` string (for a second computer without a
   camera). Nothing in the Agents Window shows the secret twice.
3. **Viewer claims.** The Viewer page opens the link, signs in with Clerk, and calls
   `POST /v1/remote-access/pairs/<pairId>/claim` with `{ viewerLabel, proof: HMAC-SHA256(pairSecret, hostId) }`.
   The Relay checks the caller's `userId` equals the pair's, compares `proof` in constant time,
   and sets `state: "paired"`, `viewerLabel`, no TTL. Five failed claims on one `pairId` revoke
   the offer. The Relay now knows the pair exists; it still does not know `pairSecret`.
4. **Keys.** Both ends derive `pairKey = HKDF-SHA256(pairSecret, salt = pairId, info = "flowleap-remote-access-pair-v1")`
   and keep it in their local secret storage. `pairSecret` is discarded by both after derivation.

Lifetime (grill Q14): a pair lives until removed on either end or until the Host signs out, which
calls `DELETE /v1/remote-access/pairs?hostId=…`. `GET /v1/remote-access/pairs` lists the caller's
pairs (`pairId`, `hostId`, `hostLabel`, `viewerLabel`, `createdAt`, `lastSeenAt`), never a key.
`DELETE /v1/remote-access/pairs/<pairId>` removes one.

## 6. End-to-end encryption

Per connection, after both `welcome` frames, Host and Viewer run one handshake **inside payload
frames** (the Relay forwards them blind):

1. Each side sends an ephemeral X25519 public key with `tag = HMAC-SHA256(pairKey, pubKey ‖ role)`.
2. Each verifies the peer's tag with `pairKey`, computes the shared secret, and derives
   `sessionKey = HKDF-SHA256(shared, salt = pairId, info = "flowleap-remote-access-session-v1")`.
3. Every later payload is `AES-256-GCM(sessionKey, nonce = 4-byte direction ‖ 8-byte counter, aad = pairId)`.

The pair key authenticates the exchange; the ephemeral keys give forward secrecy. WebCrypto in
the browser and in Node 24 supplies X25519, HKDF and AES-GCM, so no new native dependency.
The plaintext inside is the AHP byte stream exactly as `webSocketTransport.ts` would carry it
over a local socket: the Viewer's `AgentHostProtocolClient` sends `initialize` as its first
message and the Host's `ProtocolServerHandler` answers. Nothing in AHP changes.

## 7. Host transport

The Host does not listen. A new `IProtocolServer` implementation (`platform/agentHost/node/
relayTransport.ts`, PRD 0018 B3) dials the Relay, performs §3 and §6, and hands one duplex
stream per live Viewer to `ProtocolServerHandler`, exactly as `startWebSocketServer` hands a
local socket today. The transport reconnects with backoff (1 s → 60 s) while Remote Access is
on, and stops on sign-out or toggle-off.

Which Agent Sessions the Host publishes is the agent host's business, not the Relay's: Claude
sessions from the `claude` agent and, per Q24 (both), the editor Patent Agent chat through the
adapter the chat-adapter spike designs. The Viewer sees one Host with two agents.

## 8. Viewer

The Viewer page is the fork's web Agents Window with the client-side `remoteAgentHost` provider
registered (PRD 0017 kept it out) and a Relay-backed transport in place of the dev-tunnels one.
Boot order: Clerk browser SDK sign-in → `GET /pairs` → pick a pair → open the Viewer socket →
read `host.appVersion` → if the loaded build differs, reload into
`https://remote.flowleap.co/<appVersion>/` (the last three builds are kept) → E2E handshake →
AHP `initialize`. "Host offline" is a page state, not an error.

## 9. What the Relay records

Nothing from the stream. Two content-free activation events through the existing contract in
`flowleap-backend/src/lib/telemetry/activation.ts` (the event union grows by two):
`remote_access_pair_created` and `remote_access_viewer_connected`, keyed by user and UTC day.
The request log line for the route carries the close code and the duration, no ids beyond the
user's.

## 10. Decisions taken here (say if you want them changed)

- **Pasteable code = the full 128-bit secret**, not a short typed code. A short code would need
  a PAKE to stay safe against an offline guess by whoever can read the Relay's transcript, and
  Node has no vetted PAKE in the standard library. A second computer pastes; a phone scans.
- **Viewer host = `remote.flowleap.co`**, because `app.flowleap.co` is the Hosted Workspace
  parent domain (ADR 0011).
- **Relay inside the backend process**, not a separate container (grill Q18), one more
  dependency (`ws`), single-instance routing in memory; a second backend instance would need
  Valkey pub/sub, which is not built until it is needed.
- **Host offline = nothing stored** (grill Q12); the `attention` frame is the only thing the
  Relay remembers per pair, and only its timestamp.
