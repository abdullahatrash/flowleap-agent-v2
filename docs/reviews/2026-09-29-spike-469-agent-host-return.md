# Spike #469: bring the agent host process back (2026-09-29)

Worktree `/Users/abdullahatrash/flowleap/wt-spike-469`, branch `spike/469-agent-host` from `main` at 45a4c6d6ddc (#464 merge). Upstream reference 480c6e142fa (1.140.0). Throwaway only. No PR.

Commits on the spike branch (all `--no-verify`):

| Commit | Content |
|---|---|
| ff94023cb54 | Copy upstream `platform/agentHost/{node,electron-main,test/node}` |
| 24491d72a36 | Wire the local agent host process and `providers/agentHost`; unregister `claudeChatSessions` |
| f6691d52d1c | Register the Dev Container service; remove the Local provider's duplicate fork action; spawn-env probe (spike only) |
| 1198ba0a784 | Accept a claude.ai subscription as a native Claude setup |
| 84007b5bd48 | Do not register the Copilot agent provider |

**Result: Claude streamed through the agent host on the user's own claude.ai login.** There was no GitHub sign-in, no proxy and no Copilot token. Q2 is not a "hard no".

---

## Q1. Cost of bringing the agent host back

### Files added (step 1, copy only)

| Tree | Files | TS lines |
|---|---|---|
| `platform/agentHost/node/**` | 1,207 | 156,544 |
| `platform/agentHost/electron-main/**` | 1 | 322 |
| `platform/agentHost/test/node/**` | 952 | 259,934 |
| Total (commit ff94023cb54) | 2,158 | 478,996 insertions (all files) |

The fork's existing `platform/agentHost/{common,browser,electron-browser}` differ from upstream in 3 files, strings only. `sessions/contrib/providers/agentHost/**` is byte-identical to upstream. It was copied by PRD 0017 and only unregistered.

### Type-check per step (`npx tsgo --noEmit -p src/tsconfig.json`)

| Step | Errors | Cause |
|---|---|---|
| Copy, fork npm deps | 929 | Old `@github/copilot-sdk` 1.0.4 (upstream 1.0.15-preview.4), old `@anthropic-ai/claude-agent-sdk` 0.3.187 (upstream 0.3.281), missing `@vscode/fs-copyfile` |
| Upstream versions of 6 packages | 9 | Transitive `@anthropic-ai/sdk` resolved to 0.129.0; second `zod` copy |
| Pin `@anthropic-ai/sdk` 0.82.0 (upstream lock), share `zod` | **0** | |
| Wiring (5 entry files) | **0** | |
| Runtime fixes (below) | **0** | |

`npm run valid-layers-check`: **pass** (exit 0, 8 GB heap as in #464).

**npm deps the adoption must take** (root `package.json`, from upstream): `@github/copilot-sdk` 1.0.15-preview.4, `@anthropic-ai/claude-agent-sdk` 0.3.281 (dev), `@vscode/fs-copyfile` 2.0.0, `@devcontainers/cli` 0.88.0, `@microsoft/mxc-sdk` 0.8.0, `@vscode/copilot-api` ^0.5.2, `tar` to dependencies, and the lock pin `@anthropic-ai/sdk` 0.82.0. The spike did not touch the shared `node_modules`. It used an overlay `node_modules` in the worktree with these packages installed in the scratchpad (`deps/`, `deps2/`).

**The core unit-test harness cannot load the copied tests yet.** Its import map comes from the fork's `package.json`, so `@vscode/fs-copyfile` does not resolve ("Failed to resolve module specifier"). The deps change above fixes that. The 952 test files were type-checked but not run.

### Wiring (commit 24491d72a36, 5 files, +33 / −14)

- `src/vs/code/electron-main/app.ts`: restore upstream's `ElectronAgentHostStarter` + `AgentHostProcessManager` and `agentHostProcessManager.start()` (+13 / −2).
- `workbench/workbench.desktop.main.ts`: import `services/agentHost/electron-browser/agentHostService`; drop the fork's `EditorRemoteAgentHostServiceClient` override.
- `workbench/workbench.common.main.ts`: import `agentSessions/agentHost/agentHost.contribution` (not `remoteAgentHost.contribution`).
- `sessions/sessions.desktop.main.ts`: import the electron agent host service and the 9 `providers/agentHost` lines; drop the fork's `IAgentHostService` override. SSH/WSL null services stay.
- `sessions/sessions.common.main.ts`: import the 3 `providers/agentHost` lines; comment out `claudeChatSessions.contribution`.
- **Kept out, unchanged:** shared-process SSH / Dev Container / WSL / Tunnel services, `serverServices.ts` spawn modes, github, codeReview, tunnelHost, remoteSessions, cloud sandbox, copilotConnectors, `remoteTunnelService`, `modelPickerTryout`, `remoteAgentHost.contribution`.

### Runtime fixes the launch forced (commit f6691d52d1c, 84007b5bd48, 1198ba0a784)

1. **Duplicate command `workbench.action.chat.forkConversation`.** The fork's Local provider (`localChatSessions.contribution.ts`) carries a copy of upstream's fork action, made in PRD 0017 A11 because `agentHostForkActions` was kept out. Removed the copy (−84 lines). It is redundant when the agent host is in.
2. **`LocalAgentHostSessionsProvider depends on UNKNOWN service devContainerAgentHostService`.** Registered `sessions/contrib/providers/remoteAgentHost/browser/devContainerAgentHostService.ts` (+2 lines). It is inert without a stored dev container host.
3. **Claude showed "No models available" with a logged-in claude.ai account.** See Q2. `claudeTransportMode.ts` +4 lines.
4. **Copilot agent registered unconditionally.** See the startup table. `agentHostMain.ts` +4 lines.

### Every place the agent host wants GitHub, Copilot or Microsoft at startup

Measured with a fresh throwaway profile. Run B is before fix 4, run C is after it. `lsof` found **no external TCP connection from the agent host process or its children.**

| # | What | Where | Effect without a fix | Neutralized? |
|---|---|---|---|---|
| 1 | `CopilotAgent` always registered | `platform/agentHost/node/agentHostMain.ts:154` | Spawns GitHub's `copilot-runtime` binary (98 MB). Picker shows "Copilot — Sign in" and makes it the **default agent**. A turn fails: "Authentication is required to start a session." | **Yes.** Gated behind env `VSCODE_AGENT_HOST_COPILOT_AGENT_ENABLED` (default off). Run C: no `copilot-runtime`, Claude is the default. |
| 2 | Auth lookups for protected resources `https://api.github.com` and `https://api.github.com/repos` | Log at `workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts:769`. Resources come from `ClaudeAgent.getProtectedResources()` (`claudeAgent.ts` ~729), which always lists the Copilot resource (`required: false`) and the repo resource | Local only: "No signed-in session resolved" at info level. Run B: 168 lines in about 1 minute. Run C: 108. No network, no prompt. | **No.** Fix = one file, either return `[]` from `getProtectedResources` in the fork or lower the log to trace. This is the same log spam the old fork saw (~12 probes). |
| 3 | `https://github.com/login/oauth` as the authorization server | Protected-resource metadata in the protocol stream | Data only, no network | Falls out with #2 |
| 4 | `CodexAgent` registered | `agentHostMain.ts:176-190`, default on outside Stable quality | Picker shows "Codex" (OpenAI) | **No.** Default `chat.agentHost.codexAgent.enabled` to false. Setting only. |
| 5 | `product.agentSdks` SDK download (`main.vscode-cdn.net`) | `agentSdkDownloader.ts:296` | Nothing in dev: the fork has no `agentSdks`, so no download | Not needed in dev. **Packaging item**, see below. |
| 6 | Telemetry endpoints in code (`copilot-telemetry.githubusercontent.com`, `agentHostMicrosoftTelemetry.ts`) | `platform/agentHost/node` | No connection seen from the agent host | Not verified further. Needs a check in a built product. |

The Electron network service (shared by the main process and renderers, not the agent host) held 4 external connections, including GitHub and Microsoft address ranges. **These are not attributed to the agent host and were not compared with a status-quo baseline.**

Two startup lines `Unknown channel: agentHostClientByokLm` / `agentHostClientProxy` are a race. The renderer registers both channels in `platform/agentHost/electron-browser/localAgentHostService.ts:631-637`. Nothing failed.

### Packaging item (not needed to launch in dev, needed for a release)

In a built product Claude registers only if `product.agentSdks.claude` exists (`agentHostMain.ts:170`, `isEnvironmentBuilt && agentSdkDownloader.isAvailable`). Upstream stamps `agentSdks` from `build/agent-sdk/produce.ts` and uploads tarballs to `main.vscode-cdn.net`. The fork already has `build/agent-sdk/`. **We need either our own SDK host (flowleap-releases or the Hetzner box) plus the stamp, or to ship the SDK in the app and relax the gate.** The Claude SDK platform package is 224 MB (darwin-arm64). The status quo ships the SDK inside `extensions/copilot`. `@github/copilot-sdk` is a runtime dependency with a 98 MB platform package; with the Copilot agent gated it could be excluded from packaging.

---

## Q2. Auth of the agent host's Claude — **native chain works; no hard no**

Upstream has two transports, `proxy` (Copilot CAPI, needs GitHub) and `native` (the user's own Claude credentials).

- `platform/agentHost/node/claude/claudeTransportMode.ts:13` defines `'proxy' | 'native'`. "`native` talks to Anthropic directly on the user's own credentials (no GitHub)."
- `claudeSdkOptions.ts:131-141`: `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are set **only** when `transport.kind === 'proxy'`. Native omits both.
- `claudeSdkOptions.ts:386-401` (`buildSubprocessEnv`): native inherits the real `process.env` (so `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `HOME` and the keychain reach the CLI). Proxy strips `ANTHROPIC_API_KEY`.
- `claudeAgent.ts:757-776` (`_ensureAuthenticated`): a model qualified with `@provider=anthropic` routes native. Only proxy needs a handle, and the handle exists only after a GitHub token arrives through `authenticate()` (`claudeAgent.ts:778`). The fork never sends one, so the proxy never starts.
- `claudeModelSelection.ts:110-128`: the provider in the model id decides the transport. The picker's native models carry `@provider=anthropic`, so the setting `chat.agentHost.allowSignedOutWhenUsable` is **not needed** when a model is selected. It only affects a model-less session's fallback.

**One upstream bug blocks claude.ai logins.** `isClaudeAccountSetUp` (`claudeTransportMode.ts:92-104`) needs `tokenSource` or `apiKeySource`. With SDK 0.3.281 a keychain claude.ai login reports neither. A direct SDK probe on this machine returned only `apiProvider: firstParty`, `subscriptionType: "Claude Max"`, organization and email. The agent host log said `setUp=false … tokenSource=absent` and the picker said "Claude — No models available". The spike accepts `subscriptionType !== undefined` too (+4 lines). After that: `setUp=true`, 4 models (Opus 1M, Fable, Sonnet, Haiku).

**Seam to keep the native chain = 1 file, 1 function** (`isClaudeAccountSetUp`). The routing itself needs no change. Compare the fork's extension-host path `extensions/copilot/src/extension/chatSessions/claude/node/claudeCodeAgent.ts:530-534`: it also omits `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` on purpose (decision #59). Both paths use the same native chain.

Spawn env proven at runtime (spike probe in `claudeAgentSession.ts`, names only, never values):

```
[SPIKE469] Claude spawn transport=native model=@provider=anthropic:opus%5B1m%5D permissionMode=default
  plugins=…/agentPlugins/vscode-synced-customization-agent-host-claude-…/777512665 mcpServers=client,host
  spawnEnvCredKeys=[] settingsEnvCredKeys=[]
```

No `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `GITHUB_TOKEN` or Copilot token reached the spawn. The CLI used the keychain login.

---

## Q3. Feature parity for the fork's Claude intents on the agent host path

| Intent | Verdict | Evidence / seam |
|---|---|---|
| Bundled skills (`src/vs/sessions/skills/**`) | **Works as-is** | Built-in storage is synced by default (`agentHostLocalCustomizations.ts:46-50`, `SYNCABLE_STORAGE_SOURCES` includes `builtIn`). The synced plugin handed to the SDK held 73 skills, including every `flowleap-*`, `recipe-*` and `persona-*` skill. |
| MCP servers from `mcp.json` | **Works by design, not verified live** | Delivered as `ClientForwarded` through the `client` MCP server (`agentHostMcpServerSupport.ts:315`). The spawn got `mcpServers=client,host`. No user `mcp.json` was tested. |
| Permission modes (`claudePermissionModePicker`) | **Replaced by upstream** | Upstream `agentHostClaudePermissionModePicker.ts` renders ("Ask Before Edits"). The fork picker (209 lines + 207 test) is dropped. Check the mode list against the fork's before adopting. |
| Workflow templates | **Works as-is** | Chips render (Prior-Art Search, FTO, …). They live in `newChatWidget.ts`, not in the provider. |
| FlowLeap CLI nudge | **Needs a re-apply (1 line)** | `flowleapCliNudge.contribution.ts:19` matches session type `claude-code`. The agent host type is `claude`. It never fires. |
| Patent-voice strings | **Mostly works; small re-apply** | "Pitch your idea" renders. After a session starts the input says upstream's "Chat with Claude". Check the other #65/#76/#93 strings. |
| Model picker (native Claude tiers) | **Works; default differs** | The SDK lists Opus (1M), Fable, Sonnet, Haiku. The default is Opus 1M, not the fork's B9c Sonnet default. Re-apply B9c in the agent host model picker. |
| Local provider | **Keeps working, needs a move** | It imports `localChangesets.ts` from the `claudeChatSessions` folder. Move that file before deleting the folder. |
| Sign-in | **Works** | No GitHub sign-in prompt in any run. |

**Gains confirmed for Claude:**

- **Multi-chat:** confirmed live. "New Chat in This Session" (⌘T) and "Show Chat Tabs" in the session menu.
- **Fork and side chat:** declared in `claudeAgent.getDescriptor()` as `multipleChats: { fork: true, sideChat: true }` (`claudeAgent.ts:718`). Registered by `agentHostForkActions.ts`. Not clicked live.
- **Delete and rename:** always supported for agent-host sessions (`baseAgentHostSessionsProvider.ts:1141`). Rename shows in the menu.
- **Quick chats:** `localAgentHostSessionsProvider.ts:182` handles `isQuickChat` for `claude`.
- **Also gained:** external Claude CLI sessions from `~/.claude/projects` are listed under "External". It discovered 94 of the machine's sessions. Resume and replay work through upstream code.

---

## Q4. A Claude session through the agent host in the launched app

- **Streamed.** On a fresh throwaway profile, with Claude selected, the prompt "Reply with exactly the word PONG…" came back as `PONG`. The spawn-env line is in Q2.
- **The agent host process started** (`AgentHostProcessManager: agent host started`). There was **no GitHub sign-in prompt** in any of the three runs.
- **The Agents Window lists the agent host Claude session type.** The picker showed Claude, Codex, Local, plus Copilot before fix 4. After fix 4 Claude is the default.
- **Removing `contrib/providers/claudeChatSessions`** broke two things. The Local provider's duplicate fork command collided with upstream's, so its copy was removed. `localChangesets.ts` is still imported from that folder, so the folder can only be deleted after moving that file. The CLI nudge key also needs changing (Q3).

Also observed:

- **A second agent sent "hi" into the run-A window.** It probably drove the same debugging port 9333. That turn went to the default Copilot agent and failed with "Authentication is required". The later runs used port 9344.
- **Privacy:** the agent host writes the full protocol traffic, including message content, to `<logs>/ahp/ahp-*.jsonl`. That was 2.9 MB after one turn; "PONG" appears 6 times. It is local and size-capped (`common/ahpJsonlLogger.ts`). Decide whether to keep it on in release builds.

---

## Q5. Remote Access consequence

- **Yes, the protocol serves everything a web Viewer needs.** The same `ProtocolServerHandler` (`node/protocolServerHandler.ts`, 2,394 lines) serves the local window over a MessagePort. The live run used it for state, the model catalog, sending a message and permission answers.
- **Listening transports today:** `startWebSocketServer` (`node/agentHostMain.ts:565-630`) listens on `VSCODE_AGENT_HOST_PORT` or `VSCODE_AGENT_HOST_SOCKET_PATH`, with `?tkn=` validated by `connectionTokenValidate` (`node/webSocketTransport.ts:36-38, 180-191`). There is also an on-demand UDS/named-pipe server, `IConnectionTrackerService.startWebSocketServer()` at `agentHostMain.ts:359-400`.
- **Seam for an outbound dial is one interface.** `ProtocolServerHandler` takes any `IProtocolServer` (`common/state/sessionTransport.ts:85-90`: `onConnection: Event<IProtocolTransport>`, `address`). `MessagePortProtocolServer` (`node/messagePortProtocolServer.ts`, 167 lines) is a second implementation already. A `RelayProtocolServer implements IProtocolServer` would dial `wss://api.flowleap.co/…` outbound. It would emit one `IProtocolTransport` per paired Viewer stream (E2E-decrypted), and be registered in `agentHostMain.ts` the same way as lines 589-616. No listening socket is needed.
- **Viewer side seam exists.** Web clients already run the protocol over an arbitrary duplex stream (`common/webSocketOverDuplex.ts`, used by `common/tunnelAgentHostConnector.ts:298` with `/?tkn=`). Connection factories plug in through `IRemoteAgentHostService.registerConnectionFactory`, which `devContainerAgentHostService.ts:189` uses. A Relay factory follows that pattern.
- **So Remote Access reduces to:** Relay (backend) + Pairing + Viewer (upstream web window + a Relay connection factory) + the host-side outbound transport.
- **Estimate for the agent host side:** `RelayProtocolServer` ≈ 250-400 lines plus the E2E layer. Wiring in `agentHostMain.ts` ≈ 30 lines. A renderer trigger ("Remote Access on") over the existing connection-tracker IPC ≈ 50 lines. Roughly 3-5 days, excluding the Relay backend and Pairing UI. Option B (serve AHP from the window's state model) would have to rebuild what `ProtocolServerHandler` already does.
- **Q24 note, untested:** the host has a renderer BYOK bridge (`byok: { kind: 'renderer' }` in `agentHostMain.ts:131`, `AgentHostClientByokLmChannel`). The Copilot agent can run on BYOK models when signed out (`copilotAgent.ts:1489-1492`). That runs GitHub's `copilot-runtime`, which is a separate decision.

---

## Q6. Size of the fork diff that remains

**(A) Agent host in (as in this spike):**

| File | Fork change |
|---|---|
| `platform/agentHost/common/{agentHostEnablementService,agentHostSchema,agentHostStarter.config.contribution}.ts` | Strings only (existing) |
| `platform/agentHost/node/claude/claudeTransportMode.ts` | +4 (subscription counts as setup) |
| `platform/agentHost/node/agentHostMain.ts` | +4 (gate Copilot agent) |
| `platform/agentHost/node/claude/claudeAgentSession.ts` | +6, spike probe only; drop it |
| `workbench/contrib/chat/browser/agentSessions/agentHost/agentHostToolSetEnablementService.ts` + fork-only `agentHostCustomizationToolSets.ts` | Existing fork intent (#147) |
| `sessions/contrib/providers/agentHost/**` | 0 files differ |
| Wiring vs upstream (lines `<`/`>` in diff) | `app.ts` 11, `sharedProcessMain.ts` 37, `serverServices.ts` 125, `workbench.desktop.main.ts` 4, `workbench.common.main.ts` 9, `sessions.desktop.main.ts` 34, `sessions.common.main.ts` 20 |

`app.ts` falls from the #464 keep-out hunk to only the FlowLeap CLI lines. The shared-process and server diffs are the remaining keep-outs (SSH/WSL/tunnel, server spawn modes); taking upstream's server file would remove 125 lines of diff. **Net new fork edits under `platform/agentHost/node`: 2 files, about 8 lines.** Expected follow-ups: getProtectedResources or log level (1 file), Codex default, CLI nudge constant, B9c Sonnet default. Estimate under 15 files and under 100 lines of fork diff in the agent host area.

**(B) Status quo:**

- `sessions/contrib/providers/claudeChatSessions/**`: 7 files, **1,972 lines**. The provider is 935, `localChangesets` 398, permission picker 209, actions 83, contribution 30, tests 317.
- It is re-applied at every sync against upstream's changing `ISessionsProvider` / `ICopilotChatSession`. The Local provider's copied fork action (84 lines) is also re-applied.
- **Hidden cost of B:** it depends on `extensions/copilot/src/extension/chatSessions/claude/**`, which is **95 files, 19,870 lines (10,547 of them tests)**. Upstream deleted that implementation in 78a7b6c291b, so the fork now maintains it alone. Option A lets both go.

---

## Recommendation: **GO** (adopt the agent host; Q10 → A)

The single strongest reason: the agent host runs Claude on the user's own claude.ai login with no GitHub, no proxy and no Copilot token. It needs a 4-line fix in one upstream function, and it proved this by streaming a live turn. That removes the only hard-no condition. It also swaps about 22k fork-owned lines (the 2k-line provider plus the 20k-line extension-host Claude that upstream abandoned) for about 100 lines of fork edits on upstream code. It brings multi-chat, fork, side chat, delete and quick chats, and hands Remote Access a ready protocol server whose `IProtocolServer` seam takes an outbound Relay transport. **Follow-up size, about 2 weeks for one agent:**

1. **npm deps sync and test run** (1-2 days): the 7 package changes, run the 952 agent host test files, re-check the tree with #464's replay kit.
2. **Neutralize and re-apply** (1-2 days): Copilot gate, protected resources or log level, Codex default off, CLI nudge constant, B9c Sonnet default, patent strings in the agent host input, move `localChangesets.ts`, delete `claudeChatSessions` and later the extension-host Claude.
3. **Packaging** (2-4 days): own `agentSdks` host and stamp, or bundle the Claude SDK and relax the gate; exclude the Copilot SDK; macOS sign and notarize with the new binaries; a built-product network check for telemetry.
4. **Upstream bug report** for `isClaudeAccountSetUp` and the claude.ai keychain login, so the fork edit can go away.
5. **Decide on** the full-content `ahp/*.jsonl` log in release builds.
