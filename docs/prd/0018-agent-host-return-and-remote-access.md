# PRD 0018 — Agent host returns; Remote Access v1

**Status:** ACTIVE 2026-09-29 — ADR 0009 accepted; issues #472–#484 filed (A1+A2 #472, A3 #473, A4 #474, A5 #475, A6 #476, A7 #477, A8 #478, B1 #479, B2 #480, B3 #481, B4 #482, B5 #483, B6 #484)
**Date:** 2026-09-29
**Base:** main at the PRD 0017 merge (`45a4c6d6ddc`, upstream 1.140 + fork intents)
**Decides:** ADR 0009. **Glossary:** `CONTEXT.md` → Remote Access. **Evidence:** spike #469
(`docs/reviews/2026-09-29-spike-469-agent-host-return.md`), Remote Access grill (memory note
`remote-access-phone-viewer-design`).
**Spike branch to mine, not merge:** `spike/469-agent-host` in `../wt-spike-469` (5 checkpoint
commits: copy, npm bumps, wiring, runtime fixes, auth fix).

## Why

Two goals share one prerequisite.

- **Stop maintaining Claude alone.** Upstream deleted the extension-host Claude path; the fork
  keeps 21,842 lines of it alive. Upstream's agent host runs Claude on native claude.ai auth
  (verified live in #469) and gives multi-chat, fork, side chat, delete, rename, quick chats and
  external session discovery for free.
- **Let a phone follow a running Agent Session.** With the agent host in, the Host side of Remote
  Access is upstream's protocol server; we add a Relay, Pairing, a Viewer page and one outbound
  transport.

Phase A lands the agent host. Phase B lands Remote Access v1 (watch plus respond). Phase A ships
on its own release; Phase B does not start until A is on main.

## Phase A — Agent host returns (reverses PRD 0004 for the agent host only)

### A1 (#472) — Copy the agent host process back and wire it (core)
From `spike/469-agent-host` commits "copy", "wiring": `platform/agentHost/node/**`,
`electron-main/**`, the server halves of `platform/agentHost/test/**`; register
`sessions/contrib/providers/agentHost/**`, `workbench/services/agentHost/electron-browser/
agentHostService`, the starter in `src/vs/code/electron-main/app.ts`, shared-process and server
services, `workbench/contrib/chat/browser/agentSessions/agentHost/agentHost.contribution`, the
Dev Container service registration. Keep OUT (PRD 0017 keep-out, unchanged): github, codeReview,
tunnelHost, remoteSessions, cloud sandbox, copilotConnectors, Microsoft remoteTunnelService,
modelPickerTryout. tsgo 0, layers pass. **Do not** delete the fork provider yet.
Guardrail: no file under `extensions/copilot` changes in this slice.

### A2 (#472) — npm dependency bumps that the agent host needs (build)
The 7 package changes from the spike (copilot-sdk 1.0.15-preview.4, claude-agent-sdk 0.3.281,
`@anthropic-ai/sdk` pinned 0.82.0, mxc-sdk 0.8, copilot-api 0.5, fs-copyfile, devcontainers/cli),
lockfile, `npm ci` green under Node 24, the ssh2/cpu-features stub kept. Exclude
`@github/copilot-sdk`'s 98 MB platform package from packaging once A3 gates the Copilot agent.
Lands with A1 in one PR if CI cannot be green with either alone.

### A3 (#473) — Gate the Copilot and Codex agents; native Claude auth fix (core)
Copilot agent never starts (else copilot-runtime becomes the default agent and demands GitHub
auth); Codex hidden from the picker by default; the 4-line `isClaudeAccountSetUp` fix so a
keychain claude.ai login counts (spike commit "auth fix"); the GitHub auth-lookup log spam
(108–168 lines/min, no network) silenced at its one file. Guardrail: cite decision #59 in the
code comment on the spawn env; no `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` anywhere on the native path.

### A4 (#474) — Privacy: no full-content session log on disk (core)
The agent host writes full session content to a local log. Disable it in the fork, or reduce it
to metadata (session id, timings, tool names). Add a test that the log sink receives no message
text. This is a release blocker for Phase A (ADR 0009 decision 4).

### A5 (#475) — Re-apply the fork's Claude intents on the agent-host path (sessions)
CLI nudge keys on session type `claude` (was `claude-code`); B9c recommended Sonnet default in the
agent-host model picker (spike saw Opus 1M as default); patent-voice strings after a session starts
("Chat with Claude" → fork voice, check #65/#76/#93 list); the Local provider's `localChangesets.ts`
moved out of the `claudeChatSessions` folder; compare upstream's permission-mode list with the
fork picker's and add any mode the fork had. Verify MCP servers from a user `mcp.json` reach the
SDK (spike: by design, not tested live).

### A6 (#476) — Delete the fork-only Claude path (sessions + extension)
Remove `src/vs/sessions/contrib/providers/claudeChatSessions/**` and the extension-host Claude
implementation under `extensions/copilot/src/extension/chatSessions/claude/**` plus its
registrations (the `claude-code` session type). Keep `extensions/copilot`'s Patent Agent chat,
BYOK, skills plumbing and the `flowleap` auth provider untouched. Guardrail: grep for
`claude-code` afterwards; the only survivors are vendored skill text.

### A7 (#477) — Ship the Claude SDK from flowleap-releases (release)
`build/agent-sdk/produce.ts` produces per-platform tarballs; the release workflow uploads them to
`abdullahatrash/flowleap-releases` next to the installers and stamps `product.agentSdks.claude`
(URL template + sha) into the built `product.json`, following `stamp-flowleap-version.mjs`.
Dev builds stay unstamped (Claude from the local SDK, as in the spike). Notarization covers the
SDK's native binaries on macOS. Dry run on all six platforms before the release. Guardrail: the
checked-in `product.json` stays clean (ADR 0008 decision 3 pattern).

### A8 (#478) — Tests and acceptance (verify)
Run the 952 copied agent-host test files (they type-check; the harness needs A2). Founder
eyeball on the real profile: Claude session streams on the claude.ai login; multi-chat, fork,
side chat, rename, delete; bundled skills listed (73 in the spike); external `~/.claude/projects`
sessions listed; no GitHub prompt anywhere; a BYOK turn in the editor chat still works.
Update `agents-window-claude-repurpose` memory and `CONTEXT.md` "Agent Session" if wording
changes.

## Phase B — Remote Access v1 (watch plus respond)

### B1 (#479) — Q24 decision + Relay contract (docs, founder)
Founder decides Q24 on the Phase A window: Claude sessions only, or also editor Patent Agent
chats via a chat-model adapter. Write the Relay wire contract as a short doc:
`wss://api.flowleap.co/v1/relay/host` and `/v1/relay/viewer/<hostId>`, Clerk bearer on connect,
entitlement check (trial + Pro), pair id, E2E envelope (X25519 key agreement from the Pairing
code, XChaCha20-Poly1305 frames), keepalive, and the content-free `attention` frame for the later
push. One ADR is enough (0009); no new one.

### B2 (#480) — Relay route in flowleap-backend (backend)
WebSocket route per B1 inside the existing Node process: Clerk verify, entitlement gate, pair
registry in Valkey (pair id → host socket), byte forwarding, no persistence, activation events
`remote_access.pair_created` / `remote_access.viewer_connected` through the existing activation
telemetry contract. Nginx vhost change on `api.flowleap.co` for WebSocket upgrade. Load test:
1,000 idle sockets on the 4 GB box.

### B3 (#481) — Host outbound transport + Pairing UI (core)
New `IProtocolServer` implementation that dials the Relay and hands frames to
`ProtocolServerHandler`; E2E layer per B1; "Remote Access" toggle in the Agents Window title bar
(replaces upstream's tunnel toggle, kept out); Pairing dialog with code + QR; pairs stored in
machine-local storage; revoked on sign-out; Mac keep-awake (`powerSaveBlocker`) while on and a
session runs; setting `flowleap.remoteAccess.keepAwake` default on.

### B4 (#482) — Viewer page (web build + hosting)
Static web build of the Agents Window served versioned at `app.flowleap.co/agents/<version>/`
from the Hetzner box (nginx vhost + certbot + DNS); a small boot page that runs the Clerk browser
SDK, lists the user's pairs, and boots the workbench with the client-side `remoteAgentHost`
provider registered (PRD 0017 kept it out) against the Relay transport; version handshake
reloads into the Host's version; keep last three builds. Release workflow publishes the web build
next to the installers.

### B5 (#483) — End-to-end acceptance (verify)
Founder on the phone: pair, follow a running Agent Session, answer a permission prompt, send a
follow-up message, second Viewer at the same time, Host offline shows "Host offline", sign-out on
the Host revokes the phone. Console on both ends clean of Relay errors.

### B6 (#484) — Attention push (v1.5, after B5)
Content-free web push from the Relay on the Host's `attention` frame; fixed text.

## Explicit non-goals

- No agent host for the editor window's Patent Agent chat; it stays extension-host BYOK.
- No GitHub, Copilot, code review, tunnel, cloud sandbox or host-to-host delegation.
- No new session creation, diff review or terminal from the phone (Remote Access v2/v3).
- No plaintext relay, ever.

## Execution

- One PR per slice, based on main, merged in order A1+A2 → A3 → A4 → A5 → A6 → A7 → A8, then
  B1 → B2 ∥ B3 ∥ B4 → B5 → B6. Each PR body names the slice and its guardrails.
- Agents work in their own worktrees (`../wt-<slice>`), Node 24 via nvm, node_modules links per
  the worktree memory note; never `git add -A`.
- Phase A release = v0.5.0 with a CHANGELOG entry "Agents Window sessions now run in the agent
  host: multi-chat, fork, side chat, rename, delete".

## Outcome

_Filled as slices land._
