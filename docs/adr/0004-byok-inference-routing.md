# BYOK inference routing: no `copilot` LM provider, deterministic activation

In the BYOK build we do **not** register the `copilot` language-model provider, and we
activate the chat feature deterministically on startup instead of gating it on
Copilot entitlement. This keeps every chat turn on the user's own provider key and
removes a race that left the default agent unregistered.

## Context

Inference is BYOK only (ADR 0001 / 0002; the `/v1/chat/completions` proxy is retired).
But two pieces of upstream Copilot wiring fight that model:

1. `LanguageModelAccess` registers an `lm` provider for the **`copilot` vendor**
   (`languageModelAccess.ts`). VS Code's `vscode.lm` selection path dispatches a turn
   **straight to the provider registered for the selected model's vendor**, bypassing
   `PatentAIEndpointProvider.getChatEndpoint` (which is designed to reroute non-BYOK
   vendors). When a `copilot`-vendor model is resolved — typically a persisted/default
   model id, not a user pick — the turn hits `CopilotLanguageModelWrapper` → CAPI, which
   #8 disabled, producing `Missing Authentication header`.

2. The default chat participant (`github.copilot.default`) registers only when
   `ConversationFeature` flips `activated = true`, which is gated on
   `hasToken || hasByokModels`. In a BYOK build no Copilot token ever arrives, so
   activation waits on the async `selectChatModels({})` probe. The activation blocker is
   force-completed on startup, so core's `ChatService.activateDefaultAgent` can run before
   the participant registers → `No default agent registered` (self-heals once the probe
   resolves, but never produces the clean console #23 requires).

Both symptoms share one root: a BYOK-only build where Copilot's entitlement-gated
activation and CAPI-vendor routing have no place.

## Decision

- **Do not register the `copilot` `lm` provider** in this build. With it gone, no
  `copilot`-vendor model is reachable for a chat turn, so the only resolvable chat models
  are the user's BYOK providers (registered independently by `byokContribution`). This is
  robust regardless of *how* a `copilot` model was being resolved. `copilotcli` and
  `claude-code` stay registered — they are `targetChatSessionType`-scoped and cannot leak
  into a default patent turn; suppressing them is a separate agent-sessions concern.
  `PatentAIEndpointProvider` keeps all five vendors in `NON_BYOK_VENDORS` as a backstop.
- **Activate chat deterministically on startup**, co-located with the existing BYOK
  force-complete in `ConversationFeature`, so the default agent registers synchronously
  during activation instead of racing the BYOK probe. The `hasToken || hasByokModels` gate
  is a vestige of Copilot *entitlement* gating; in a BYOK product there is no entitlement —
  chat is always available, and whether a turn can *run* is a turn-time question answered
  by `PatentAIEndpointProvider` (the connect-provider prompt). `reevaluate()` is left intact
  for the now-vestigial token path to keep the diff small and upstream-mergeable.
- **No-key affordance:** prefer core's native no-models empty-state (which now surfaces,
  because no false-positive `copilot` model masks it). Only wire the orphaned
  `hasByokModel()` gate at the request handler if core's empty-state proves insufficient.

## Consequences

- A future reader or an upstream VS Code merge will see the missing `copilot` provider
  registration and the unconditional activation and may try to "restore" them. **That
  reintroduces this exact bug.** Both are deliberate — this ADR is the marker.
- Verification of the routing needs only a local BYOK key, not live Clerk sign-in
  (inference is decoupled from the FlowLeap Session). The signed-in end-to-end with a
  patent-data tool call remains #23's HITL acceptance.
