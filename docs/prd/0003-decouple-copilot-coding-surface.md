---
status: draft
relates-to: docs/adr/0001-port-patent-agent-into-builtin-copilot-extension.md, docs/adr/0004-byok-inference-routing.md
---

# PRD: Decouple from Copilot — remove the coding-product surface

## Problem Statement

The Patent AI agent is built on the GitHub Copilot Chat 0.55 extension (ADR 0001). That
foundation gave us the agent loop, tools framework, chat UI, and BYOK routing — but it also
ships the entire **Copilot coding product** alongside: inline completions/NES, code review,
test-setup intents, GitHub telemetry, surveys, the Copilot CLI bridge, and cloud coding-agent
surfaces. None of it serves the patent agent. The agent keeps its general coding ability
(file tools, terminal, editing) for analysis work — that lives in the agent loop and tools
spine, not in these features.

Carrying this dead mass has real costs: a larger attack/bug surface that has already bitten
us (the copilotcli cross-realm double-load broke sign-in), slower builds and compiles,
misleading `github.copilot.*` surfaces users can stumble into, GitHub-pointed telemetry and
experimentation code we must keep neutralized, and every future upstream merge dragging in
more of a product we don't ship.

A full-repo audit (2026-07-05, three-agent sweep; map in agent memory `copilot-removal-map`)
established the boundary precisely: **~700+ files in `extensions/copilot` are cleanly
removable with zero imports from the agent spine**, another ~150 are removable after cutting
one coupling each, and the rest — chat infrastructure the patent agent runs on — must be
neutralized (already done via product.json), not deleted.

As the founder, I want the fork to *be* a patent agent, not a patent agent hiding inside
Copilot — without risking any regression in the working product.

## Solution

Remove the Copilot coding-product surface from `extensions/copilot` in independently
grabbable slices, each severing one feature cluster at its registration seam
(`contributions.ts` / `allIntents.ts` / `allTools.ts` / `services.ts` DI defines /
`package.json` contributes), then deleting the now-unreferenced folders. Phase 1 slices have
no spine imports and can land in any order. Phase 2 slices each cut one known coupling
first. Shared chat infrastructure in core (`src/vs`) is explicitly **out of scope**: it
stays neutralized via product.json because deletions there maximize upstream-merge pain for
zero functional gain.

Every slice ends at a compiling checkpoint (`npm run typecheck-client` equivalent for the
extension: its own build), with a clean console at startup (no missing-contribution errors)
and a live BYOK patent turn as the acceptance gate.

**Kept deliberately:** inline chat (Cmd+I — useful for in-place edits to patent documents),
`extensions/github` + `extensions/github-authentication` (zero copilot coupling; preserve
git-over-HTTPS credentials), notebook support (30 spine imports; not worth the surgery),
and the `extensions/copilot` folder name (load-bearing for the build:
`build/lib/copilot.ts`, gulp tasks, `compile-copilot` scripts).

**Deferred:** the `github.copilot.*` settings namespace + nls branding rename (separate
migration PRD — breaks saved user settings and core context-key couplings), and deleting
the core Agents window + Copilot CLI runtime (`src/vs/sessions/**` +
`src/vs/platform/agentHost/**`, ~1,170 files — its own ADR/PRD once this PRD proves out).

## User Stories

1. As a patent professional, I never see completions ghost text, `/review`, `/setupTests`,
   Copilot surveys, or any GitHub-coding affordance — the product surface is only what the
   patent agent does.
2. As a patent professional, my agent still reads/edits files, runs terminal commands,
   searches the workspace, and edits documents in place (inline chat) exactly as before.
3. As the founder, I want no code path that can send telemetry or experimentation traffic
   to GitHub/Microsoft endpoints, so neutralization stops being a maintenance obligation.
4. As the maintainer, I want each removal to be a single reviewable slice that compiles and
   starts clean, so a regression is attributable to exactly one change.
5. As the maintainer, I want the copilotcli tree gone so the class of cross-realm
   double-load bugs it caused cannot recur.
6. As an agent picking up an issue, I want the deregistration points named in the issue so
   removal is mechanical: declaration + registration + cross-refs together, clean console
   as part of done.

## Implementation Decisions

### Principles

- **Remove product, neutralize infrastructure.** Feature clusters with no spine imports are
  deleted. Shared chat infra (entitlement service, chatSetup, BYOK context keys
  `github.copilot.clientByokEnabled`/`hasByokModels`, copilot codicons, endpoint base
  classes) stays neutralized — it is the patent agent's skeleton.
- **Sever at the registration seam, then delete.** Order within a slice: remove the entry
  from `extension/vscode-node/contributions.ts` / `extension/vscode/contributions.ts` /
  `intents/node/allIntents.ts` / `tools/node/allTools.ts` / `services.ts`, remove
  `package.json` contributes + nls keys, then delete folders. Clean console is part of done.
- **Interfaces stay, GitHub-backed impls go.** Where a service interface is widely imported
  (`IExperimentationService`, telemetry, auth/token interfaces), keep the interface and the
  existing null impl; delete only the GitHub/MSFT-backed implementations.
- **The spine is untouchable:** `patentai/**`, `extension/extension/**` (entry, services,
  contributions), `intents/node/{agentIntent,askAgentIntent,toolCallingLoop}` +
  `editCodeIntent*` + `inlineChatIntent`, `tools/**` (general + patent), `byok/**`,
  endpoints consumed by `patentEndpointProvider` (`autoChatEndpoint`, `chatEndpoint`,
  `embeddingsEndpoint`, `extChatEndpoint`) + `networking`/`openai`, `prompts/**` +
  `prompt/**`, `conversation/{conversationFeature,chatParticipants,languageModelAccess}`,
  `chatSessions/claude/**`, and core services (`configuration`, `filesystem`, `terminal`,
  `tasks`, `git`, `mcp` framework, `otel`, `log`, `util`).

### Phase 1 — clean removals (no spine imports; any order; ~700+ files)

1. **Completions/NES cluster** (~650 files): `extension/completions-core` (351),
   `extension/completions`, `extension/inlineEdits` + `platform/inlineEdits`,
   `extension/xtab`, `platform/nesFetch`, `extension/typescriptContext` (114),
   `extension/renameSuggestions`, `extension/workspaceRecorder` +
   `platform/workspaceRecorder`, `platform/snippy`. Deregister:
   `JointCompletionsProviderContribution`, `CompletionsUnificationContribution`,
   `InlineCompletionContribution`, `NesRenameContribution`, `RenameSuggestionsContrib`,
   `WorkspaceRecorderFeature`, `NesActivationTelemetryContribution`. (Core's
   `renameSymbolProcessor.ts` NES commands go silently inert — no core change needed.)
2. **Review/PR + testing + coding slash intents**: `extension/review` +
   `platform/review`, `githubPullRequestTitleAndDescriptionGenerator.ts`,
   `extension/testing`, and from `allIntents.ts`: Review, SetupTests, Tests, Fix, Explain,
   TerminalExplain, GenerateCode, NewNotebook, NewWorkspace, Vscode, Search* — **keeping
   AgentIntent, AskAgentIntent, EditCodeIntent*, InlineChatIntent**. Deregister
   `SetupTestsContribution`, `FixTestFailureContribution`, `SearchPanelCommands`.
3. **Onboarding/survey/feedback/githubMcp**: `extension/getting-started`,
   `extension/onboardDebug`, `extension/survey`, feedback contribs
   (`conversation/vscode-node/feedback*.ts`), `extension/githubMcp`. Deregister
   `WalkthroughCommandContribution`, `newWorkspaceContribution`,
   `CopilotDebugCommandContribution`, `OnboardTerminalTestsContribution`,
   `SurveyCommandContribution`, `FeedbackCommandContribution`, `GitHubMcpContrib`.
4. **GitHub telemetry + ExP**: `GithubTelemetryForwardingContrib`, `ghTelemetry*`,
   `githubTelemetrySender`, `azureInsights*`, `microsoftTelemetrySender`,
   `microsoftExperimentationService` + `baseExperimentationService` (swap DI to the
   existing `nullExperimentationService`). Keep telemetry/ExP interfaces + otel path.
5. **Dormant cloud/coding-agent surfaces + quota**: `chatSessions/vscode-node/`
   copilotCloud*, pullRequest*, `jobsApiBackend`, `taskApiBackend`,
   `cloudBackendTelemetry`, `prContentProvider` (already unregistered per
   `chatSessions.ts:47-58`); `RemoteAgentContribution` (`remoteAgents.ts`);
   `ChatQuotaContribution` + `chatQuotaService*` (BYOK has no quota).
6. **Repo hygiene (zero risk)**: delete `extensions/microsoft-authentication.disabled`
   (build already skips `.disabled`), `build/copilot-migrate-pr.ts`, disabled
   `.github/workflows/*.disabled` copilot workflows.

### Phase 2 — entangled removals (cut the named coupling first)

7. **copilotcli** (98 files): relocate `IChatSessionMetadataStore` — move/reimplement
   `copilotcli/vscode-node/chatSessionMetadataStoreImpl.ts` and its `ICopilotCLIAgents`
   dependency (`copilotcli/node/copilotCli.ts`) outside the copilotcli tree (the Claude
   sessions provider consumes it via `chatSessions.ts:110-117`); then delete the tree.
   Also removes the cross-realm double-load hazard. Leave string constants
   (`NON_BYOK_VENDORS`, otel attribute names) in place.
8. **Semantic search/embeddings cluster**: drop `codebaseTool`,
   `githubRepoSemanticSearchTool`, `githubTextSearchTool` from `allTools.ts` (all dead at
   runtime — they require CAPI embeddings), then delete `workspaceChunkSearch` (ext+plat),
   `workspaceSemanticSearch`, `platform/embeddings`, `platform/chunking`,
   `platform/remoteCodeSearch`; deregister `workspaceIndexingContribution` and the
   `githubAvailableEmbeddingTypes` DI define. `findTextInFilesTool`/`findFilesTool` are
   independent and remain.
9. **CAPI/domain/platform-github unpick** (lowest priority): remove the `ICAPIClientService`
   DI define (`services.ts:183`), `capiClient`/`capiClientImpl`, `domainService` GitHub
   URLs, `platform/github` (octokit et al.), dead auth impls
   (`staticGitHubAuthenticationService`, `vscode-node/authenticationService.ts`,
   `VSCodeCopilotTokenManager`, `authenticationUpgrade*`). Requires unpicking imports in
   the endpoint base classes — keep the auth/token **interfaces** the patentai impls
   implement. May be split or dropped if the unpick spreads too wide.

### Out of Scope

- Any deletion in `src/vs` core: chatSetup, chatEntitlementService, unification,
  `copilotManagedSettings`, codicons, `hasByokModelsContribution` — neutralized, stays.
- `src/vs/sessions/**` + `src/vs/platform/agentHost/**` deletion — follow-up ADR/PRD,
  gated on this PRD landing cleanly.
- `github.copilot.*` settings namespace rename (189 properties) and package.json/nls
  branding strings (931 `github.copilot` occurrences) — separate rename/migration PRD.
  Note `product.json:53` (`chatExtensionOutputExtensionStateCommand`) must move with it.
- Notebook feature + notebook tools (30 spine imports — keep).
- `extensions/github`, `extensions/github-authentication`, `extensions/git` copilot
  strings (cosmetic; rename PRD).
- Build plumbing (`build/lib/copilot.ts`, gulp copilot tasks, `compile-copilot` scripts,
  `product-copilot.yml`, `downloadCopilotVsix.ts`) — load-bearing for packaging.

## Testing Decisions

- **Per slice:** extension compiles; app starts with a clean console (no
  missing-contribution/command errors — same bar as prior removals); a live BYOK patent
  turn (agent mode, at least one patent tool + one file edit + one terminal command)
  succeeds.
- **Phase-2 slice 7:** Claude sessions still list/create/resume after the metadata-store
  relocation.
- **Phase-2 slice 8:** `#codebase` references are gone from tool pickers; grep/find tools
  still work in an agent turn.
- **Full-PRD acceptance:** packaged build (`compile-copilot` + gulp path) succeeds; no
  network traffic to github.com/githubcopilot.com endpoints during a full agent session
  (dev-tools network audit); Cmd+I inline chat still edits a document; the L4 acceptance
  recipe (BYOK turn + real backend data + zero CAPI) still passes.
- Vitest: run with bare substring filters per the shared-tree hazard; delete test files
  belonging to removed features in the same slice.

## Further Notes

- Slices are sized for the layered-agent workflow (shared working tree — stage only your
  slice's files). Phase 1 slices are fully independent; slice 9 depends on 8 (github
  platform services lose their last consumers) and benefits from landing last.
- Expected payoff beyond hygiene: faster extension compile (completions-core alone is 351
  files), smaller VSIX, and a hard guarantee (deleted, not gated) that no GitHub telemetry
  path exists.
- The audit that grounds this PRD is reproducible: three Explore sweeps over
  `extensions/copilot/src`, `src/vs`, and repo-wide build/product wiring (2026-07-05).
