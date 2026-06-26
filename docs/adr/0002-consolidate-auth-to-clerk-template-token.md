# Consolidate authentication to the single Clerk template-token path

**Status:** accepted

The old fork carried two unrelated sign-in flows: (1) `PatentAIAuthService` — a Clerk
`flowleap` JWT-template token obtained via the system browser and returned over the
`flowleap://…/callback` deep link, stored in SecretStorage, used by backend calls and the
onboarding gate; and (2) the `flowleap` UI shell's own `authProvider.ts` — an independent
OAuth **PKCE** flow against `/oauth/authorize` with a `vscode://vscode.flowleap/callback`
redirect, its own keychain, and a second VS Code auth provider registered under **the same
id `flowleap`** (colliding with the provider that wraps #1). During the port we keep **only
the Clerk template-token path** and delete the UI shell's parallel OAuth-PKCE stack.

## Consequences

- Single source of truth for the FlowLeap Session = `PatentAIAuthService` (in the copilot
  extension), surfaced to the Accounts menu by one `flowleap` auth provider
  (`patentai/flowleapAuthProvider.ts`).
- The FlowLeap UI shell reads sign-in state via
  `vscode.authentication.getSession('flowleap', …)` instead of running its own OAuth; its
  `flowleap.signIn` command becomes an alias to `patent-ai.signIn`.
- `product.json` must grant the `flowleap` UI extension `trustedExtensionAuthAccess` to the
  `flowleap` provider, since the provider now lives in a *different* extension (copilot) than
  the consumer (UI shell).
- Deleted: `extensions/flowleap/src/authProvider.ts`, its keychain, the `/oauth/authorize`
  PKCE flow, and the `vscode://vscode.flowleap/callback` redirect.
