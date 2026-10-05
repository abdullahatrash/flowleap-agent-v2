# Upstream sync to VS Code 1.140 (PRD 0017)

These scripts turned the fork into a whole-tree sync of `src/vs` and `src/vscode-dts` with upstream 1.140. The next upstream sync is a re-run of the same kit against a newer reference, not a rediscovery.

**What they do:** copy upstream, keep what the fork deliberately keeps out, then re-apply the fork's intents as small patches written against upstream's code. Old fork hunks are never merged.

- **PRD:** `docs/prd/0017-agents-window-wholesale-sync.md`
- **Evidence:** `docs/reviews/2026-09-29-prd-0017-spike-report.md` (v1) and `docs/reviews/2026-09-29-prd-0017-spike-report-v2.md`
- **PR:** #464

| | Commit |
|---|---|
| Upstream reference (`microsoft/vscode`) | `480c6e142fa` (1.140.0) |
| Fork base the scripts were written against | `810ad70ca59` (v0.4.0) |
| Fork point of the fork | `b0b6062a946` (1.127.0) |

## Setup

A git worktree does not get `node_modules`. Step 11 installs packages, so the root one must be a real copy (an APFS clone is fast). The others can be links to a full checkout:

```bash
git worktree add ../wt-sync -b port/<name> 810ad70ca59       # or the new base
cp -c -R <checkout>/node_modules ../wt-sync/node_modules        # real copy, step 11 installs into it
ln -s <checkout>/extensions/copilot/node_modules ../wt-sync/extensions/copilot/node_modules
ln -s <checkout>/build/node_modules ../wt-sync/build/node_modules   # esbuild and gulp-merge-json live here
ln -s <checkout>/.build ../wt-sync/.build                           # the built Electron
```

**To launch the app** from the worktree (`TMPDIR=/tmp ./scripts/code.sh`), the built-in extensions also need their build output and their own `node_modules`. Without them, git, github, emmet and merge-conflict fail to activate:

```bash
for d in <checkout>/extensions/*/out <checkout>/extensions/*/dist; do cp -c -R "$d" "../wt-sync/${d#<checkout>/}"; done
for d in <checkout>/extensions/*/node_modules; do [ -e "../wt-sync/${d#<checkout>/}" ] || ln -s "$d" "../wt-sync/${d#<checkout>/}"; done
cp ../wt-sync/build/flowleap/codicon.ttf ../wt-sync/src/vs/base/browser/ui/codicons/codicon/codicon.ttf   # the dev build reads it from src/ and out/
node build/next/index.ts transpile
```

## Run

```bash
UPSTREAM=<vscode checkout at the reference commit> build/upstream-sync/1.140/run-all.sh ../wt-sync
```

Optional variables:
- `FORK`: a clone of the fork that has the base commit. Default: the worktree itself.
- `FORK_REF`: the base commit. Default: `810ad70ca59`.
- `SYNC_OUT`: where step 10 writes its file lists. Default: `$TMPDIR/upstream-sync-1.140`.

Every script takes the worktree path as its only argument. Scripts are idempotent: a patch that is already applied is skipped.

**Order** (`run-all.sh` runs exactly this): 10, 11, 12, 13, 20, 30-*, 31-*, 32, 33, 34, 35, 36, 37, 40, 41, 42.

**Verify:**
```bash
npx tsgo --noEmit -p src/tsconfig.json                        # 0 errors
(cd extensions/copilot && npx tsgo --noEmit --project tsconfig.json && npx tsgo --noEmit --project tsconfig.worker.json)
npm run valid-layers-check
node build/next/index.ts transpile && VSCODE_SKIP_PRELAUNCH=1 ./scripts/test.sh
```

## Scripts

| Script | Purpose |
|---|---|
| `10-copy-src-vs.sh` | Replace `src/vs` and `src/vscode-dts` with upstream. Restore only files the fork created (not files upstream later deleted, not `10-subsumed-fork-files.txt`). Drop the agent host server layer. Retire `platform/agentSessionState` and rewrite its imports |
| `11-npm-deps.sh` | Install the npm packages upstream's code needs at upstream's lockfile versions. Keep the lockfile stub `npm ci` needs. Give the layers checker an 8 GB heap |
| `12-copy-src-root.sh` | Copy upstream's top-level `src/` entry points (bootstrap, main, mainImpl, cli, server) where the fork never changed them |
| `13-copy-test-harness.sh` | Copy upstream's `test/unit` harness (the fork never changed it) |
| `20-keep-out.sh` | Unregister what the product does not ship: agent host, remote hosts, tunnels, and the github, codeReview and automations UI. No agent host process in main, shared process or server (#73) |
| `30-reapply-NN-A*.sh` | Agents Window intents (list A in the PRD) |
| `31-reapply-NN-B*.sh` | Intents outside the Agents Window (list B in the PRD) |
| `32-integration.sh` | Fixes needed where several re-applies meet |
| `33-test-rederive.sh` | Test expectations re-derived for FlowLeap's `product.json`, the rebrand and the #147 tools count |
| `34-keep-out-agent-host-client.sh` | Desktop `IAgentHostService` is the inert remote client; the browser null service throws on use |
| `35-local-harness-no-di-cycle.sh` | The Local harness is registered by the Local provider, which avoids a DI cycle |
| `36-kept-out-contrib-services.sh` | Register only the services of the kept-out github, codeReview and automations contributions, because core Agents Window parts inject them |
| `37-d7-rebrand-reachable-copilot-strings.sh` | Decision D7: rebrand Copilot strings a user can reach (the rest are listed in #465) |
| `40-ext-dts.sh` | Fork API proposals on top of upstream's dts, and the four edits `extensions/copilot` needs to compile |
| `41-brand-codicon-font.sh` | Regenerate the FlowLeap codicon font for the installed codicons (needs fontforge; output is not bit-identical, so keep a committed font when nothing changed) |
| `42-build-mainimpl-entry.sh` | Package upstream's `mainImpl` entry in `build/`. These are fork-owned files, already applied after this sync |

Other files:
- `lib/apply-patch.sh`: idempotent patch apply.
- `lib/save-patch.sh` and `lib/checkpoint.sh`: turn worktree edits into a new numbered script.
- `patches/`: one patch per script.
- `notes/`: per-intent notes from the four re-apply groups (aw = Agents Window, onb = onboarding and auth, chat = BYOK and chat, brand = patent mode, rebrand and MCP).
- `tools/div.mjs`: per-directory divergence (identical, stale, fork-touched, fork-only, upstream-only).
- `tools/closure.mjs`: upstream files imported transitively that the fork lacks.

## For the next sync

1. **Measure first.** Run `tools/div.mjs` on tab-separated `git ls-tree -r` lists (path, blob) for the fork HEAD, the new upstream and the fork point.
2. **Re-run the kit** against the new reference with `FORK_REF` set to the new base. Steps 10 to 13 are mechanical.
3. **Fix patches that no longer apply.** A 30/31/3x patch that fails means upstream moved that seam. Re-apply the intent by hand (read the note in `notes/`), then save the result as the new patch with `lib/save-patch.sh`.
4. **Watch for new fork changes.** Commits since `810ad70ca59` that carry fork intent need their own script. Commits that are only upstream ports are subsumed by the copy.
5. **Bump the web client's webview host.** `product.json` `webviewContentExternalBaseUrlTemplate` pins the Microsoft CDN copy of `src/vs/workbench/contrib/webview/browser/pre/` to the upstream release commit (1.140.0 = `07f806f9…`, quality `stable`). Set it to the new release commit, and check that the CDN files match `pre/` (fetch with `--compressed`). A stale pin leaves every resource-loading webview blank in the web client (#520): the host and the old `pre/index.html` speak different protocols. Desktop does not read this value.
