# Spike: the editor Patent Agent chat over the agent host protocol (PRD 0018 Phase B, Q24)

**Date:** 2026-10-17
**Branch:** `spike/remote-access-chat-adapter` in `../wt-spike-chat-adapter` (base `origin/main` 62638e93f24). Throwaway. No PR.
**Checkpoints:** `79f75e30cd4` (first cut), `da9949c134f` (restore replay, pseudo model).
**Spike diff:** 8 files, 856 added lines, 0 deleted. 0 lines in `extensions/copilot`.
**Evidence:** screenshots in `shots/` next to this file. Host and Viewer logs in `/tmp/fh/logs` and `/tmp/fv/logs` (symlinks into `profiles/`).

## Verdict

Yes. A **bridge agent inside the agent host process** (option A) publishes the desktop's editor Patent
Agent chats over the agent host protocol (AHP). A second desktop instance with upstream's
`remoteAgentHost` provider connected to the Host's agent host WebSocket (`?tkn=`). It listed the
editor chats, rendered their turns, followed a new editor turn live while it streamed, sent a message
that the Host's editor chat answered with the BYOK model, and answered a tool permission prompt
("Run zsh command? echo spike-ok"). The Host ran the command and the turn completed. The model call
stayed in the Host window's extension host. No chat text went to any agent-host log.
Option A reuses the protocol server, state manager, reducers and the planned Relay transport
unchanged: the Relay carries **one Host with two agents**. Recommendation: option A, about
1,400 production lines with tests, 4 to 6 days, one slice pair before B5.

## Q1. Where the editor chat lives

| Piece | Process | Where |
|---|---|---|
| Chat model (`IChatModel`, requests, responses, tool invocations) | Renderer of each window | `workbench/contrib/chat/common/model/chatModel.ts:1956` (`IChatModel`), `:141` (`IChatRequestModel`), `:304` (`IChatResponseModel`) |
| `IChatService` (list, load, send, cancel) | Renderer | `common/chatService/chatService.ts:2082-2225`: `onDidCreateModel` 2085, `getSession` 2110, `acquireOrLoadSession` 2125, `sendRequest` 2138, `cancelCurrentRequestForSession` 2147, `getLiveSessionItems`/`getHistorySessionItems` 2193-2194 |
| Tool confirmation | Renderer state, asked by the extension host tool | `IChatToolInvocation` `chatService.ts:877`; state `WaitingForConfirmation` 935 with `confirm(reason)`; programmatic answer `IChatToolInvocation.confirmWith(inv, { type: ToolConfirmKind.UserAction \| Denied })` 1045; reasons 853-868 |
| Patent Agent participant | Extension host of each window | `extensions/copilot/package.json:3151` (`chatParticipants`, default agents 3157/3206/3219), registered with `vscode.chat.createChatParticipant` at `src/extension/conversation/vscode-node/chatParticipants.ts:97`; tools declare confirmations in `prepareInvocation` (e.g. `tools/node/patentSearchSubagentTool.ts:121`) |
| Renderer ↔ extension host chat RPC | Both | `workbench/api/browser/mainThreadChatAgents2.ts` ↔ `workbench/api/common/extHostChatAgents2.ts` (`$invokeAgent`, 1013) |
| Model call (BYOK) | Extension host → provider | `byok/vscode-node/*Provider.ts`; seen live as `CopilotLanguageModelWrapper` → OpenRouter. Never the agent host |
| "Local" sessions in the Agents Window | Agents Window renderer + its **own** extension host | `sessions/contrib/providers/localChatSessions/browser/localChatSessions.contribution.ts:39-41`; it owns its list in profile storage (`LOCAL_CHAT_SESSIONS_PROVIDER.md`). The Agents Window loads `nativeExtensionService` (`sessions/sessions.desktop.main.ts:96`), so it has its own `IChatService` and Patent Agent |
| Agent Sessions (Claude) | Agent host utility process | `platform/agentHost/node/agentHostMain.ts` |

Consequence: "the editor chat" is not one object. Each window (editor windows and the Agents Window)
owns its own chat models in its own renderer. The adapter must run per window. The agent host
already talks back to each window per client id over reverse IPC channels (BYOK and client proxy,
`agentHostMain.ts:276-290`, renderer side `electron-browser/localAgentHostService.ts:628-650`), so
that is the seam.

## Q2. What a remote Viewer needs from a Host

The protocol is state sync: `initialize`, then `subscribe` to a channel and receive a snapshot plus
action envelopes; the client sends `dispatchAction` notifications. Minimal set:

| Viewer need | Protocol | Host side that serves it |
|---|---|---|
| Know the agent | root state `agents[]` from `initialize` | `IAgent.getDescriptor()` + `models` (`common/agent.ts:1216`) |
| List a session | `listSessions` (`node/protocolServerHandler.ts:1664`) | `AgentService` catalog; an agent feeds it with `onDidDiscoverChats` (`node/agentService.ts:1379`) |
| Render turns | `subscribe` chat channel (`protocolServerHandler.ts:1517`) | restore calls `IAgent.chats.getMessages` (`agentService.ts:1212`) → `Turn[]` (`state/protocol/channels-chat/state.ts:561`) |
| Follow a live turn | server actions `chat/turnStarted`, `chat/responsePart`, `chat/delta`, `chat/toolCallStart/Ready/Complete`, `chat/turnComplete` (`state/protocol/common/actions.ts:44-56`) | `IAgent.onDidChatProgress` `kind:'action'`. A provider may start a turn itself: "Provider-promoted turns" (`node/agentSideEffects.ts:792`) |
| Show a pending permission | tool call in `PendingConfirmation` (`channels-chat/state.ts:1303`) | signal `kind:'pending_confirmation'` → `_handleToolReady` (`agentSideEffects.ts:1464`) dispatches start + ready |
| Answer it | client action `chat/toolCallConfirmed` (`IS_CLIENT_DISPATCHABLE`, `action-origin.generated.ts:331`) | `agentSideEffects.ts:1647` → `IAgent.respondToPermissionRequest` |
| Send the next message | client action `chat/turnStarted` | `agentSideEffects.ts:1583` → turn service → `IAgent.chats.sendMessage` |

Client side: `remoteAgentHostSessionsProvider` builds session types from the host's root `agents`
list; it has no allowlist of provider ids. Live log: `Registered agent flowleap-chat from
127.0.0.1:8771 as remote-127.0.0.1__8771-flowleap-chat`. One gate exists: the Viewer will not send
while the agent has no model (`no-model-at-toolbar-build`). The provider is registered by
`sessions/contrib/providers/remoteAgentHost/browser/remoteAgentHost.contribution.ts` and
`webSocketAgentHost.contribution.ts`; PRD 0017 kept both out (`sessions.desktop.main.ts:245-247`);
the spike imports them (`sessions.desktop.main.ts:250-251`).

Upstream has nothing that serves Local (chat-model) sessions over AHP. It removed the Local provider
(fork keeps it, PRD 0017 A11). The only bridge is one-way and one-shot:
`importedTurnsFromChatModel` in `workbench/contrib/chat/browser/agentSessions/agentHost/importLocalConversationToAgentSession.ts:235`
(completed turns only, new UUIDs per call).

## Q3. The three options, measured

| | A. Bridge agent in the agent host | B. Second protocol server in the renderer | C. Patent Agent inside the agent host |
|---|---|---|---|
| Seam | new `IAgent` + one reverse IPC channel per window (same pattern as BYOK) | `IProtocolServer` + a renderer copy of the server stack | port the extension-host participant to an agent-host agent |
| Built here | yes, 856 lines, works live | no | no |
| What it reuses | `ProtocolServerHandler`, `AgentService`, state manager, reducers, catalog, WebSocket transport, the planned Relay transport, A4 log policy | nothing of the above can load in a renderer: 28 files in `platform/agentHost/node` import sqlite, fs, os or child_process | the agent host side only |
| Size of what it must replace | 0 | core of the stack is 17,323 lines in 7 files (`protocolServerHandler` 2,394, `agentService` 9,897, side effects 2,278, ...); `node/` total 68,123 | Patent Agent stack in `extensions/copilot/src/extension`: 225,443 lines, 442 files import `vscode`; the agent host has no extension API |
| Hard blockers | none found; see the gaps below | ADR 0009 decision 5 rejects a second hand-made server; it must track upstream's protocol version forever; the Relay then carries two Hosts per desktop and Pairing doubles | no `vscode` API, no chat participants, no language-model or tool API in the agent host; upstream's Copilot agent runs GitHub's `copilot-runtime`, not the participant |
| Estimate | ~1,400 lines with tests, 4-6 days | 3,000-5,000 lines for a minimal subset, plus drift at every upstream sync | a rewrite, months; not for v1 |

## Q4. The proof (local, no Relay)

Setup: Host = dev build, throwaway profile `/tmp/fh`, OpenRouter key added through Manage Models
(a plain key in `chatLanguageModels.json` does not work: secrets are references into secret
storage), env `VSCODE_AGENT_HOST_PORT=8771`, `VSCODE_AGENT_HOST_CONNECTION_TOKEN=spiketkn`.
Viewer = second dev instance, profile `/tmp/fv`, `--agents`, `chat.remoteAgentHosts` =
`ws://127.0.0.1:8771` + token. Model: Anthropic Claude Haiku 4.5 via OpenRouter.

| Step | Result | Evidence |
|---|---|---|
| Bridge agent registers, window publishes its chats | pass | `agenthost.log`: `Registering agent provider: flowleap-chat`, `client … publishes 2 chat(s)`, discovery `1 registered` |
| Viewer lists editor chats | pass | `viewer-02.png` (group "External") |
| Viewer renders an existing chat (user turns, error turn, answer) | pass | `viewer-03.png` |
| Editor turn streams live into the Viewer | pass | `viewer-04-live.png` ("Working…", partial text); log `turn … active (editor)` → `ended (complete)` |
| Viewer sends; Host editor chat answers with BYOK | pass | `viewer-09-sent.png`; log `viewer message for turn …` → `active (viewer)` → `ended (complete)` |
| Permission prompt shown in the Viewer | pass | `viewer-11-perm.png` ("Run zsh command? Running echo spike-ok", sidebar "Input needed / Allow") |
| Viewer answers; Host runs the tool; turn completes | pass | log `viewer answered toolu_… : allow`; `host-20-allowed.png` (terminal runs), `viewer-13-done.png` ("Done… output spike-ok") |

Files of the slice (all marked `FlowLeap SPIKE`):

- `platform/agentHost/common/agentHostChatMirror.ts` (143): channel name, `IAgentHostChatMirrorSource`, snapshot types, server channel, per-client registry.
- `platform/agentHost/node/flowleapChatMirrorAgent.ts` (399): the bridge `IAgent` `flowleap-chat`. It turns renderer snapshots into AHP actions (turn start, part, delta, tool start/ready/complete, confirm, turn end), publishes a permission as `pending_confirmation`, maps a Viewer turn id onto the renderer request, and forwards send, permission answer and cancel to the owning window.
- `workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatMirrorSource.ts` (288): renderer source over `IChatService`; stable part ids `<requestId>:<index>`; sends through the open chat widget (`acceptInput`) or `sendRequest`; answers with `IChatToolInvocation.confirmWith`.
- Wiring: `agentHostMain.ts` +7, `localAgentHostService.ts` +8, two `registerSingleton` (+4 each), `sessions.desktop.main.ts` +3 (Viewer provider).

Gaps the proof found (each is in the slice sizing below):

1. **The host drops actions for a chat nobody subscribes to** (`Action for unknown chat`). Correct by design, but a Viewer that subscribes during a running turn restores without an active turn. The spike replays the running turn 250 ms after `getMessages`; production needs a real hook.
2. **Send without an open chat widget has no tools.** The fallback `sendRequest` did not carry mode and tools, and the model answered "I don't have access to a terminal tool". With the chat open in the Host, the widget path worked. Production must build the same request options as the widget.
3. **The Viewer needs a model to send.** The agent publishes one pseudo model, "Editor chat model". The real model stays the editor's choice.
4. **Permission policy has two owners.** `_handleToolReady` asks the host permission manager for auto-approval and offers "Allow in this Session", which writes agent-host session rules, not the editor's. The editor already decided to ask; the bridge must opt out of host auto-approval and offer Allow/Skip only.
5. A completed tool-call part and an earlier error turn rendered empty in the Viewer after the history refresh; after a Viewer send the session moved to the group "Unknown". Cosmetic, mapping fixes.
6. A non-window client (`ctx = agentHost`) got the reverse-channel call and timed out after 1 s. Register the mirror only for renderer windows.
7. Not tested: the Host's own Agents Window will list the same chats twice (Local provider plus `flowleap-chat`); the local agent-host provider must hide `flowleap-chat`.

## Q5. Keep-outs and privacy

- **No proxy branch.** The bridge agent has no model, no SDK and no network code; its model list is a pseudo entry. Every turn, also the Viewer's, ran in the Host window's extension host against OpenRouter directly (exthost log shows `CopilotLanguageModelWrapper`). ADR 0009 decision 2 is untouched.
- **No content in agent-host logs.** `grep` for the chat text in all Host and Viewer logs: hits only in the Host extension-host log (the error stack of the first failed turn) and `terminal.log` (the command), both editor-side and unchanged. `agenthost.log` holds ids, counts and kinds only (the agent logs no text by design). The AHP JSONL log (`logs/*/ahp`, 297 KB of Viewer WebSocket traffic) holds no chat text: the mirrored traffic passes the same `toSessionLogMetadata` policy (`common/sessionLogContent.ts`, default `metadata`, full content only with `chat.agentHost.ahpJsonlLoggingIncludeContent: true`).
- **New on disk, local only:** the agent-host catalog `User/globalStorage/agent-host.db` table `sessions_v2` stores the chat **title** (the first user message, here "Reply with exactly one short sentence…"), and the host creates one `agentSessionData/<id>/session.db` per mirrored chat (no chat text found in them). This is a second local copy of the title next to the editor's own chat store. It never reaches the Relay. Decide whether the catalog may keep it.
- Over the Relay, the mirrored content is ordinary AHP frames inside the E2E envelope of B1; nothing new for the Relay.

## Q6. Sizing for PRD 0018

Slices (new, between A8 and B5; one PR for C1+C2 because neither tests alone):

| Slice | Content | Files | Lines (est.) |
|---|---|---|---|
| C1 Chat mirror contract + renderer source | contract; source over `IChatService`; one converter shared with `importLocalConversationToAgentSession.ts` (stable ids, live tool states); widget-equivalent request options (gap 2); `mainWindow` timers | `platform/agentHost/common/agentHostChatMirror.ts`, `workbench/.../agentHostChatMirrorSource.ts`, `importLocalConversationToAgentSession.ts` | ~450 + ~250 tests |
| C2 Bridge agent | `flowleap-chat` `IAgent`; restore hook (gap 1); pseudo model (gap 3); permission opt-out (gap 4); part mapping (gap 5) | `platform/agentHost/node/flowleapChatMirrorAgent.ts` | ~450 + ~300 tests (AgentService harness with a fake mirror connection) |
| C3 Wiring and guards | register per renderer window only (gap 6); hide `flowleap-chat` in the local Agents Window (gap 7); catalog title policy; setting to switch editor-chat publishing off | `agentHostMain.ts`, `localAgentHostService.ts`, two contributions, `localAgentHostSessionsProvider.ts` | ~120 |

Total ~1,400 lines, 4-6 days. Order: after A8 (agent host shipped), in parallel with B2-B4, before B5.

What B-slices must change:

- **B1:** Q24 = both. The wire contract does not change: the Relay carries one Host; the Host has two agents (`claude`, `flowleap-chat`).
- **B3:** no transport change. The "Remote Access" toggle must also start editor-chat publishing (or publishing is always on and only the transport is gated). The Host must keep the window that owns a chat open: a closed window offers nothing, like a closed Host.
- **B4:** the Viewer registers only the `remoteAgentHost` provider (already planned); it lists both agents with no second provider. The Viewer page must show the pseudo model and Allow/Skip for editor tools.
- **B5:** add acceptance cases: follow an editor chat, answer an editor tool prompt, send to an editor chat with the chat view closed on the Host.
- **CONTEXT.md:** "Agent Session" is "one conversation with the Patent Agent in the Agents Window". Remote Access now also follows editor chats; widen the term or add "Editor Chat" to the Remote Access section.

## Recommendation

**Option A, bridge agent in the agent host.** It is proven live end to end, it reuses every piece of
the Host side that ADR 0009 already chose (protocol server, state, Relay transport, A4 log policy),
it keeps the Model Path in the extension host, and it needs no change to `extensions/copilot`.
Size: ~1,400 lines with tests, 4-6 days, slices C1+C2 then C3. B is a second protocol server that
ADR 0009 rejected; C is a rewrite of the Patent Agent.

## Decisions needed

1. Q24 confirmed as "both" with option A: add slices C1-C3 to PRD 0018 (and issues).
2. May the agent-host catalog store editor-chat titles (first user message) on disk, or must the bridge publish a neutral title ("Editor chat, <date>") and keep the real title in memory only?
3. Which editor chats does a Host publish: all chats of open windows (spike), only chats with activity in the last N days, or only chats the user marks?
4. Permission policy for editor tools answered from the phone: Allow/Skip only (recommended), or also "Allow in this Session" written to the editor's own tool-approval store?
5. Is the Agents Window's own Local chat published too (the spike does: the source runs in every window), or editor windows only?
6. Is publishing on whenever Remote Access is on, or a separate switch per Host?

## Notes for whoever repeats this

- Throwaway profiles `/tmp/fh` (Host) and `/tmp/fv` (Viewer) point into `profiles/`. The Host profile's secret storage holds the OpenRouter key; delete `profiles/` when done.
- The Host Agents Window was not opened; the Viewer profile had Claude disabled after the first run, because its local agent host listed a real `~/.claude/projects` session title.
- Driver: `driver/cdp.mjs` (Playwright over CDP; `mouse`, `type`, `typeenv`, `shot`, `eval`).
