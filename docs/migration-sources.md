# Migration Source Repositories — where to port FROM

`flowleap-agent-v2` is the migration **target**. The source material lives in **two sibling
repos checked out next to this one** (same parent folder):

```
<parent>/
├── flowleap-agent-v2/      ← THIS repo (TARGET; VS Code 1.127, copilot-chat 0.55 built-in at extensions/copilot)
├── vscode/                 ← old VS Code fork (1.121): branding, themes, FlowLeap UI Shell, core src/vs customizations
└── vscode-copilot-chat/    ← old Copilot Chat fork (0.39): the Patent Agent — patentai/, ~70 tools, skills, agent intent, BYOK, auth
```

From this repo, reference them as **`../vscode`** and **`../vscode-copilot-chat`**. (The module
locations below are stable; the absolute parent folder is dev-machine-specific — the sibling
layout is assumed.)

**Version gap:** the port crosses copilot-chat **0.39 → 0.55** and vscode **1.121 → 1.127**.
RE-APPLY the patent delta onto the newer base — do **not** copy-paste 0.39/1.121 files. Isolate
the true patent delta by diffing each old repo against **its own upstream base**, not old-vs-v2.

## Where each issue ports FROM

| Issue | Source repo · location |
|---|---|
| #3 prune languages | `../vscode/extensions/` — derive the keep/remove set by diffing against this repo's `extensions/` |
| #4 UI shell + theme | `../vscode/extensions/flowleap/` (theme, sidebar, home, chat panel). **DROP** `src/authProvider.ts` (ADR 0002) |
| #5 icons/codicons | `../vscode/resources/{darwin,win32,linux}/`, `../vscode/build/flowleap/`, the FlowLeap logo SVG |
| #6 remove Copilot CLI/CAPI surfaces | mostly THIS repo's `extensions/copilot/`; vendor-exclusion reference: `../vscode-copilot-chat/src/extension/patentai/vscode-node/patentEndpointProvider.ts` (`NON_BYOK_VENDORS`) |
| #7 scaffold patentai + BYOK | `../vscode-copilot-chat/src/extension/patentai/{common,vscode-node}` (config, models, model/endpoint providers) |
| #8 disable CAPI | reference `patentEndpointProvider.ts`; do **NOT** port `patentAuthService` `_createMockToken()` |
| #9 system prompt + agent intent | `../vscode-copilot-chat/src/extension/agents/vscode-node/patentResearchAgentProvider.ts`, `agentTypes.ts`, + the patent system prompt |
| #10 consolidate auth | `../vscode-copilot-chat/src/extension/patentai/vscode-node/patentAuthService.ts`, `flowleapAuthProvider.ts`; consumer side `../vscode/extensions/flowleap/` |
| #11 + #12–#17 tools | patent tools in `../vscode-copilot-chat/package.json` (`languageModelTools`) + `src/extension/tools/`; backend client `patentBackendClient.ts` |
| #18 tool parity | compare registered set against `../vscode-copilot-chat/package.json` `languageModelTools` |
| #19 Patent Skills | `../vscode-copilot-chat/assets/skills/*/SKILL.md` + `chatSkills` in `package.json` |
| #20 context keys + prompt templates | `../vscode/src/vs/workbench/common/patentIdeContextKeys.ts`, `../vscode/src/vs/workbench/contrib/snippets/browser/patentPromptTemplates.ts` — **RELOCATE** into a dedicated patent area |
| #21 onboarding gate | `../vscode/src/vs/workbench/contrib/welcomeOnboarding/` + `onboardingSignInGate.ts` (pure state machine + its test) |
| #22 product.json wiring | `../vscode/product.json` — the old fork's `defaultChatAgent` neutralization is the reference |
| #24 FlowLeap CI | `../vscode/.github/workflows/ci.yml` as a model; the ripgrep `GITHUB_TOKEN` gotcha is documented in `../vscode/AGENTS.md` |

See also: [PRD #1](docs/prd/0001-migrate-patent-agent-to-flowleap-agent-v2.md), `docs/adr/0001` (single-repo port), `docs/adr/0002` (auth consolidation), `CONTEXT.md` (glossary).
