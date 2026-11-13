# Group `chat` — editor chat core: BYOK, model picker, prompt roots, tool sets, MCP UI

Worktree: `/Users/abdullahatrash/flowleap/wt-1146-chat`, branch `port/1146-chat`.

## Owned paths
`src/vs/workbench/contrib/chat/**` except `chat.shared.contribution.ts`, `browser/agentSessions/sessionTypeAvailability.ts`, `browser/agentSessions/agentHost/agentHostSessionType.ts`, `browser/agentSessionsConfiguration.ts` (aw) and `browser/remoteAccess/**`, `common/remoteAccess/**`, `electron-browser/remoteAccess/**`, `browser/agentSessions/agentHost/agentHostChatMirrorSource.ts`, `test/browser/agentSessions/agentHostChatMirrorSource.test.ts`, `test/browser/remoteAccess/**` (agenthost). Also `src/vs/workbench/contrib/mcp/**`, `src/vs/workbench/services/mcp/**`, `src/vs/platform/mcp/**`, `src/vs/platform/chat/**`, `src/vs/workbench/contrib/inlineChat/**`, `src/vs/workbench/api/**` for chat/lm-related mainThread/extHost files, `src/vscode-dts/**` (API proposals; the fork proposals `agentsWindowActivation` and `timeline` are restored fork-only files).

Read `docs/reviews/2026-11-13-upstream-survey-1.140-to-1.146-chat-byok-build.md` sections A and B first: it says per seam whether the 1.140 patch re-anchors or must be re-derived (the model picker was rewritten by `09ab182715d`; `getCustomizationToolSets` `d7d2fd6929d` subsumes B6e; `VALID_PROMPT_FOLDER_PATTERN` now lives in `platform/chat/common/chatSettings.ts`).

## Intents (kit script names; patches in `build/upstream-sync/1.146/patches/`)
1. `31-reapply-19-B3a` BYOK nudge, `31-reapply-20-B3b` BYOK rejected key (applies as-is; verify), `31-reapply-21-B3c` per-model token totals (applies; verify), `31-reapply-22-B3d` chat extension always enabled, `31-reapply-23-B3e` no-model way out (re-derive on the tabbed picker: `modelPickerWidget.ts` ~904-962, `modelPickerPresentation.ts` ~165).
2. `0f93554f310` BYOK mode never routes the model picker to Copilot setup (chatSetup + picker; re-derive with B3e).
3. `31-reapply-24-B9a` claude.md off by default (applies; verify), `31-reapply-25-B9b` personal Claude skills off, `31-reapply-26-B9c` recommended default Sonnet (the Agents Window picker half is A5.2 `2a864555392`, seam `findRecommendedDefaultModel`).
4. `31-reapply-27-B10a` subagent header on the ext-host path, `31-reapply-28-B10b` tree find matches description (applies; verify), `31-reapply-29-B10c` add context files from disk, `31-reapply-30-B10d` chat output zero height (applies; verify), `31-reapply-31-B10e` provider agents with unbacked URIs (CustomizationHarnessServiceBase ctor unchanged; optional 4th arg fits).
5. `31-reapply-40-B6a` + `31-reapply-45-B6a` MCP gallery = FlowLeap registry (also check `1f871d21f97` registry slash-URL fix against the FlowLeap registry URL), `31-reapply-41-B6b` FlowLeap default marketplace, `31-reapply-42-B6c` customization list clipping and `31-reapply-43-B6d` MCP list action state (probably subsumed — verify, then drop), `31-reapply-44-B6e` MCP tools in the tools section (subsumed by `getCustomizationToolSets`; verify, drop).
6. `#577` (`4a669f5e336`) load skills, instructions, prompts and agents from `.flowleap/` and `~/.flowleap/`: `promptFileLocations.ts`, `promptFilesLocator.ts`, `promptsService*.ts`; add `.flowleap` to the sensitive edit locations the MSRC fix introduced (`platform/chat/common/chatSettings.ts`); the fork-only test `promptsServiceCustomizationItemProvider.test.ts` expects `PromptFilesLocation.FlowLeapWorkspace` (tsgo errors below). New kit script `31-reapply-47-B11-flowleap-prompt-roots`.
7. Patent tool sets + reference names: fork-only `browser/agentSessions/agentHost/agentHostCustomizationToolSets.ts` and `common/tools/patentChatToolReferenceNames.ts` (+ tests) from `b2d60c8408a`, `d3213dfd879`, `#774`, `#814`, `#826` — they compile; check they still plug into the 1.146 tool-set registration (`83acb7dc514` changed late-registering tool sets; `getCustomizationToolSets` is the new seam) and that `patent_ai` tag guarding still works. New kit script `31-reapply-48-B12-patent-tool-sets` if any seam edit is needed.
8. `778a70b1612` native Mistral provider in the model picker (`languageModels.ts`, `modelSelection.ts`): re-anchor; adopt the new `languageModelCapabilities`/`languageModelRateLimit` proposals only if the seam demands it. New kit script `31-reapply-49-B13-mistral-provider`.
9. `#593` (`b09b348544f`, `e1b9d1a4761`) list a hosted user MCP server once; install gallery MCP servers on the remote from the web client (`workbench/services/mcp`). New kit script `31-reapply-50-B14-mcp-hosted`.
10. `40-ext-dts` — the fork API proposals (`vscode.proposed.agentsWindowActivation.d.ts`, `vscode.proposed.timeline.d.ts` are fork-only and restored) plus whatever `extensions/copilot` needs to compile against 1.146's dts: run `cd extensions/copilot && node ../../node_modules/@typescript/native/bin/tsc --noEmit --project tsconfig.json` and `--project tsconfig.worker.json`, fix the extension only where the dts forces it (the PRD 0017 precedent: `voiceProgress` no-ops on the stream classes and test mocks). Report the extension error count before and after. `extensions/copilot` edits are allowed ONLY for dts-forced compile errors.
11. `33-test-rederive` for tests in your paths.
12. `fix(webview)` `d55da1027b5` open product-scheme links from webviews on web: `workbench/api/browser/mainThreadWebviews.ts` + its fork-only test expects `getWebviewLinkRoute` (tsgo error below). New kit script `31-reapply-51-B15-webview-product-links`.

## tsgo errors in your paths at the checkpoint
```
src/vs/workbench/contrib/chat/test/browser/aiCustomization/promptsServiceCustomizationItemProvider.test.ts(56,138)/(57,132): TS2339 'FlowLeapWorkspace' does not exist on typeof PromptFilesLocation
src/vs/workbench/api/test/browser/mainThreadWebviews.test.ts(10,10): TS2305 '"../../browser/mainThreadWebviews.js"' has no exported member 'getWebviewLinkRoute'
```

## Registrations for aw
List any line you need in `chat.shared.contribution.ts` or the `workbench.*.main.ts` entry points.
