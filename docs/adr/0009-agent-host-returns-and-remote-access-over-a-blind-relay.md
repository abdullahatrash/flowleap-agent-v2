# The agent host process returns, and Remote Access serves it over a blind Relay

**Status:** accepted (2026-09-29)

PRD 0004 removed upstream's agent host process because, in mid-2026, it was Copilot-only dead
weight and our Claude sessions ran in the extension host. Upstream then made the agent host the
**only** Claude path (`78a7b6c291b`, 2026-08-07) and deleted the extension-host Claude
implementation. After the 1.140 whole-tree sync (PRD 0017) the fork kept Claude alive through a
fork-only provider over 19,870 lines of extension code that upstream no longer maintains. At the
same time we decided to let a phone follow a user's own Agent Sessions (**Remote Access**, see
`CONTEXT.md`). Spike #469 (`docs/reviews/2026-09-29-spike-469-agent-host-return.md`) showed that
upstream's agent host runs Claude on the user's own claude.ai login with no GitHub, no proxy and
no Copilot token. We therefore **bring the agent host back** and **build Remote Access on its
protocol server**, joined to the phone by a FlowLeap **Relay** that cannot read the traffic.

## The decisions

1. **Claude sessions run in upstream's agent host process again; the fork-only
   `claudeChatSessions` provider and the extension-host Claude path are deleted.** Rejected:
   keeping the fork provider (1,972 lines plus 19,870 lines of orphaned extension code, re-applied
   at every sync, and missing multi-chat, fork, side chat, delete and quick chats). The agent host
   leaves about 8 fork lines under `platform/agentHost/node`. This reverses the removal in PRD 0004
   for the agent host only; the GitHub, Copilot, code-review, tunnel, cloud-sandbox and remote
   delegation clusters stay unregistered (PRD 0017 keep-out).
2. **Model auth stays native (decision #59, unchanged).** The agent host's Claude is spawned with
   no `ANTHROPIC_BASE_URL` and no `ANTHROPIC_AUTH_TOKEN`; the CLI's own credential chain (claude.ai
   login or the user's `ANTHROPIC_API_KEY`) is the only path. The Copilot agent inside the host is
   gated off and its runtime never starts. Any future change that routes agent-host model calls
   through a proxy needs a new ADR.
3. **The Claude SDK ships from a host we control.** A built product enables Claude only when
   `product.agentSdks.claude` names a download; upstream points at Microsoft's CDN. We stamp our own
   `agentSdks` at build time and serve the tarballs from `flowleap-releases` (same pattern as ADR
   0008's Update Feed). Rejected: bundling the 224 MB SDK in the app (doubles the installer for a
   component that updates on its own cadence) and relaxing the gate (dev builds would silently
   depend on whatever `claude` is on PATH).
4. **Session content never leaves the machine through our infrastructure.** The agent host's
   full-content local session log is disabled or redacted in the fork before adoption ships. The
   Remote Access **Relay** is a WebSocket route inside `flowleap-backend` that checks the Clerk
   token and entitlement, then forwards bytes it cannot decrypt; Host and Viewer agree the key at
   **Pairing** (short code or QR, same FlowLeap user on both ends). The Relay stores nothing and
   holds nothing while a Host is offline. Rejected: Microsoft Dev Tunnels (the relay demands a
   GitHub or Microsoft login it verifies itself; a Clerk token means nothing to it), and a
   plaintext relay "for now" (it makes "does FlowLeap see my data" a maybe).
5. **The Host is the agent host's own protocol server; Remote Access adds one outbound
   transport.** Upstream's `ProtocolServerHandler` accepts any `IProtocolServer`; the Host dials
   out to the Relay with a new transport class instead of, or in addition to, listening on a local
   socket. The Viewer is upstream's web Agents Window with the client-side `remoteAgentHost`
   provider, served versioned from our own box so it always matches the Host's protocol version.
   Rejected: serving the protocol from the Agents Window renderer over the fork's state model
   (the earlier Q10 option B; it would have been a second, hand-maintained protocol server).

## Consequences

- Every future upstream sync is a copy for the agent host tree; the fork's Claude surface shrinks
  from tens of thousands of lines to a handful.
- Users without a claude.ai login or Anthropic key still have no Agents Window sessions (unchanged
  since #59). The editor Patent Agent chat remains the BYOK surface. Whether Remote Access also
  follows editor chats is the open Q24 in `CONTEXT.md`'s Remote Access notes, decided in PRD 0018.
- Release pipeline gains an SDK-publishing step and a larger notarization surface (the SDK's
  platform binaries).
- The Relay is uptime we own; it lives on the existing Hetzner box next to the API.
